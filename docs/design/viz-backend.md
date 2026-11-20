---
feature: viz-backend
ready: yes
updated: 2026-11-20
owner: designer
milestone: M1
features: viz-backend
---

# viz-backend: server skeleton that records accepted launches

## Goal
The viz-web server is a skeleton in M1. It subscribes to NATS with
`@albertoriorda95/trajectory-proto` and records every accepted launch request
published on `launches.accepted` (launch_id, accepted_at, request), so the team
can check that a `POST /launches` reaches the viz-web server through NATS.
Success: after a launch is accepted, `GET /api/accepted-launches` lists it
within 1 s, and the server reports its health and its NATS state.

## Out of scope
- The SSE live stream (`GET /api/live`, replay, Last-Event-ID, `bus` events,
  keep-alive, slow-client cap) and the subscription to `trajectories.computed`:
  M3, designed in `viewer.md`. Nothing produces trajectories in M1.
- The history endpoints `GET /api/launches` and
  `GET /api/launches/{id}/trajectory` and the read-only DB user (viewer, M3).
- The Viewer UI (M3).
- A durable record of the accepted requests: out of scope for M1. The record
  is in memory only and is not a history (see Data and API); it is rebuilt
  from the stream at start-up. Persistence is store's job.
- Producing trajectories (propagation, M2).

## User flows
1. **Record.** A `LaunchAccepted` arrives on `launches.accepted`: the server
   keeps launch_id, accepted_at and request in its record.
2. **Read.** `GET /api/accepted-launches` returns the record, newest first.
3. **Restart.** At start-up the server replays `launches.accepted` from the
   stream and rebuilds the record; whatever the stream still holds (7 days)
   is back once the replay catches up.
4. **NATS lost and back.** The subscription drops: `/healthz` answers 503
   `degraded` and `status.viz-web` reports `degraded` while the server can
   still publish; the record keeps what it has and stays readable. On
   reconnect the consumer resumes with no gaps and the state returns to `ok`.

Edge cases:
- No launch yet: `GET /api/accepted-launches` returns `[]`.
- A message that does not decode or has no launch_id: not recorded, logged,
  `PipelineError` with service `viz-web` on `pipeline.errors`.
- The same launch delivered twice (redelivery, replay): recorded once, by
  launch_id (the first one stays).
- More than N entries (N = 1000): the oldest are dropped; the endpoint returns
  at most N. Entries older than the stream's 7 days do not come back after a
  restart.
- Right after a restart the read endpoint can be empty or partial until the
  replay catches up; the server does not report this (`/healthz` is plain
  liveness).
- Several replicas: each has its own ordered consumer with deliver policy
  "all", so all end up holding the same set.

## Screens and states
None. The server has no UI in M1.

## Data and API
Entity, the **record of accepted launches**: `launch_id`, `accepted_at`,
`request` (the `LaunchRequest`). The `config` of the message is not kept.

Where it is kept: in memory in the server process, as a map keyed by launch_id
bounded to the most recent N = 1000 entries by stream order. The viz-web
server has no write access to PostgreSQL (its user is read-only and arrives in
M3) and store stays the only writer, so nothing is written to the database. It
is rebuilt at start-up from the `LAUNCHES` stream (7 days), so a restart loses
nothing the stream still holds and replicas agree.

Subscription: an ordered, ephemeral JetStream consumer on `launches.accepted`
(`LAUNCHES_ACCEPTED` of the library), deliver policy "all", on the `LAUNCHES`
stream; each replica has its own.

Contract change, `services/viz-web/server/openapi.yaml` (backend):
- `GET /api/accepted-launches`: 200, a JSON array, newest first, at most 1000
  items: `{ launch_id: string (uuid), accepted_at: string (RFC 3339, UTC),
  request: LaunchRequest }`. `request` is the `trajectory.v1.LaunchRequest` in
  proto3 JSON with the proto field names (snake_case), produced with the
  library's `toJson`; it is described by reference to the proto message, not
  duplicated. No query parameters, no pagination in M1.
- `GET /healthz`: unchanged, plain liveness (503 `degraded` without NATS,
  nothing else).

The path is chosen so as not to collide with the M3 `GET /api/launches` and
`GET /api/launches/{id}/trajectory`. It exists for the tests and for checking
the pipeline; the viewer may replace it later.

Status: `ServiceStatus` on `status.viz-web` every 5 s (`ok`; `degraded` while
the subscription is down, when it can publish).

Breaking for existing clients: no (new route).

## Acceptance criteria
- [ ] After a `LaunchAccepted` is published on `launches.accepted`, `GET /api/accepted-launches` returns it within 1 s with its launch_id, accepted_at and request (the JSON decodes with the library's `fromJson` to the published request).
- [ ] The list is newest first; with no launch it is `[]`.
- [ ] The same message published twice appears once.
- [ ] With 1001 distinct launches published, the endpoint returns 1000, without the oldest.
- [ ] After a server restart, the launches still on the stream are listed again, with no duplicates, within 5 s after start-up (at most 1000 messages on the stream).
- [ ] A message that does not decode, or has no launch_id, is not listed and produces one `PipelineError` with service `viz-web` on `pipeline.errors`.
- [ ] Stopping NATS makes `/healthz` answer 503 and `GET /api/accepted-launches` keeps answering with the record; restarting NATS returns `/healthz` to 200 and a launch published afterwards is listed, without restarting the server.
- [ ] `status.viz-web` receives a heartbeat every 5 s (± 1 s).

## Test seams
- Server: `GET /api/accepted-launches` and `GET /healthz` through Fastify listening on a random port, with a fake bus behind the subscription port (Vitest): catches ordering, dedupe by launch_id, the bound of N, decode-error handling; misses real NATS.
- Integration: the server against a real NATS (Testcontainers) with the streams of `proto/nats/streams/`: catches the consumer settings (ordered, deliver "all"), rebuild after restart, reconnection, the `PipelineError` publication, the heartbeat; misses the browser.

## Reuse
- Fastify (foundations).
- NATS client: nats.js v3 `@nats-io/transport-node` and `@nats-io/jetstream` (Apache-2.0).
- Types and subject names: `@albertoriorda95/trajectory-proto` as a workspace dependency (contracts#1); the server uses its `LAUNCHES_ACCEPTED`, `PIPELINE_ERRORS` and `statusSubject("viz-web")`, never a literal subject, and its `fromBinary` and `toJson`.
- The record: a plain map in the server, written here (a few lines; no cache library).
- Integration tests: `testcontainers` for Node (MIT) with a NATS container.

## Decisions
- 2026-11-20 — The M1 viz-web server is a skeleton: it consumes `launches.accepted` and records the accepted requests; the SSE live stream and `trajectories.computed` move to `viewer.md` (M3) — user's request on PR #31: nothing produces trajectories in M1.
- 2026-11-20 — The record (launch_id, accepted_at, request) is kept in memory in the server, bounded to the latest 1000, deduplicated by launch_id, rebuilt at start-up by an ordered ephemeral JetStream consumer on `launches.accepted` with deliver policy "all" — viz-web has no write access to PostgreSQL (read-only user in M3) and the 7-day stream lets every replica rebuild the same set.
- 2026-11-20 — `/healthz` stays plain liveness (503 `degraded` without NATS, nothing else); no readiness gate on the start-up replay, so the list can be empty or partial right after a restart — user's answer on PR #31.
- 2026-11-20 — A durable record is out of scope for M1; the in-memory record is explicitly not a history — user's answer on PR #31.
- 2026-11-20 — `GET /api/accepted-launches` (newest first, proto3 JSON request) as the minimal read endpoint, for the tests — a path that does not collide with the M3 `GET /api/launches`; new route, not breaking.
- 2026-11-20 — `status.viz-web` heartbeat, `pipeline.errors` for bad messages, `/healthz` in M1; history endpoints and the read-only DB user in M3 — the user confirmed the M3 scope.
- 2026-11-20 — nats.js v3 and `testcontainers` (Node) — maintained clients.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | backend | [viz-web] Server: ordered JetStream consumer on `launches.accepted` (deliver all), in-memory record of accepted launches (latest 1000, dedupe by launch_id), `GET /api/accepted-launches`, `status.viz-web` heartbeat, `pipeline.errors` for bad messages, `server/openapi.yaml` updated, Vitest tests with a fake bus and integration tests on NATS | contracts#1, foundations#7 | - |

## Readiness checklist
- [x] goal, users and out of scope agreed
- [x] every flow has its error and edge cases
- [x] every screen has empty, loading, error and success states (no UI)
- [x] contract changes written, breaking changes approved by the user
- [x] acceptance criteria are observable
- [x] test seams agreed
- [x] reuse decided: team libraries and new dependencies named, or "none"
- [x] task breakdown with roles and dependencies
- [x] no open questions
