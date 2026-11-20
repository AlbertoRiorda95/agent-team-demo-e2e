---
feature: viz-backend
ready: yes
updated: 2026-11-20
owner: designer
milestone: M1
features: viz-backend
---

# viz-backend: live trajectories over SSE

## Goal
The viz-web server subscribes to `trajectories.computed` and pushes every
trajectory to the browsers over Server-Sent Events (`GET /api/live`), so the
Viewer (M3) can show the latest one within 2 s of the 202. Success: a client
connected to `/api/live` receives the latest trajectory at once and each new
one as it is computed, and knows when the server has lost NATS.

## Out of scope
- The history endpoints `GET /api/launches` and
  `GET /api/launches/{id}/trajectory` and the read-only DB user (viewer, M3).
 
- The Viewer UI (M3).
- Producing trajectories (propagation, M2): in M1 the tests publish them.

## User flows
1. **Connect.** The browser opens `GET /api/live`. The server answers
   `text/event-stream`, sends `event: bus` with the NATS state, then the
   latest trajectory if it has one (`event: trajectory`, `id: <launch_id>`).
2. **New trajectory.** A `TrajectoryComputed` arrives on NATS: the server
   keeps it as the latest and sends it to every connected client.
3. **Reconnect.** The browser reconnects with `Last-Event-ID`: if it equals
   the latest launch_id, the trajectory is not sent again.
4. **Bus lost and back.** The NATS connection drops: every client gets `event:
   bus` `{"nats":"disconnected"}`, the latest trajectory stays in memory;
   on reconnect `{"nats":"connected"}` and any trajectory computed meanwhile.

Edge cases:
- No trajectory yet (fresh stream): only the `bus` event; the client waits.
- Server restart: at start-up it reads the last message of
  `trajectories.computed` from the stream, so "latest" survives the restart.
- A message that does not decode or has no launch_id: not pushed, logged,
  `PipelineError` on `pipeline.errors`.
- The same trajectory delivered twice: sent once (same launch_id as the
  latest: dropped).
- An idle connection: an SSE comment every 15 s keeps proxies from closing it.
- A slow client: its pending writes are capped; above the cap the server
  closes it and the browser reconnects.

## Screens and states
None here. The Viewer's "live disconnected" state (M3) comes from the
EventSource error or from `bus: disconnected`.

## Data and API
Contract change, `services/viz-web/server/openapi.yaml` (backend):
- `GET /api/live`: 200 `text/event-stream`. Events:
  - `bus`: data `{"nats": "connected" | "disconnected"}`.
  - `trajectory`: `id` = launch_id; data = a `trajectory.v1.TrajectoryComputed`
    in proto3 JSON with the proto field names (snake_case) and enums as names
   . The schema is described by reference to the proto
    message, not duplicated: the UI decodes it with the library's `fromJson`.
- `GET /healthz`: unchanged (503 `degraded` without NATS).

Subscription: an ordered, ephemeral JetStream consumer on
`trajectories.computed`, deliver policy "last" at start, then new messages;
each replica has its own, so any replica serves any client.

Status: `ServiceStatus` on `status.viz-web` every 5 s
(`ok`; `degraded` while the subscription is down, when it can publish).

Breaking for existing clients: no (new route).

## Acceptance criteria
- [ ] With one `TrajectoryComputed` on the stream, a new client of `/api/live` receives `bus` connected and then that trajectory, with `id` = its launch_id, within 1 s.
- [ ] A trajectory published while two clients are connected reaches both within 500 ms; its JSON decodes with the library's `fromJson` to the published message.
- [ ] Reconnecting with `Last-Event-ID` equal to the latest launch_id gets no trajectory event; with another id, gets the latest.
- [ ] A message that does not decode is not pushed and produces one `PipelineError` with service `viz-web`.
- [ ] Stopping NATS sends `bus` disconnected to the clients and `/healthz` answers 503; restarting it sends `bus` connected without restarting the server.
- [ ] An idle connection receives a comment line every 15 s.
- [ ] `status.viz-web` receives a heartbeat every 5 s (± 1 s).

## Test seams
- Server: `GET /api/live` through Fastify listening on a random port, with a fake bus behind the subscription port (Vitest): catches the SSE format, replay of the latest, Last-Event-ID, fan-out, keep-alive, the bus events; misses real NATS.
- Integration: the server against a real NATS (Testcontainers) with the streams of `proto/nats/streams/`: catches the consumer settings, restart recovery of the latest, decode errors; misses the browser.

## Reuse
- Fastify (foundations); SSE written on the raw reply (the format is a few lines, no plugin).
- NATS client: nats.js v3 `@nats-io/transport-node` and `@nats-io/jetstream` (Apache-2.0).
- Types and subject names: `@albertoriorda95/trajectory-proto` as a workspace dependency (contracts#1); the server uses its `TRAJECTORIES_COMPUTED`, `PIPELINE_ERRORS` and `statusSubject("viz-web")`, never a literal subject.
- Integration tests: `testcontainers` for Node (MIT) with a NATS container.

## Decisions
- 2026-11-20 — SSE pushed by the viz-web server, "live" = the latest computed trajectory — project.md.
- 2026-11-20 — `trajectory` events in proto3 JSON with proto field names, decoded with the library's `fromJson` — readable with curl, about 0.9 MB at the defaults.
- 2026-11-20 — Latest trajectory replayed on connect, `id` = launch_id with Last-Event-ID, `bus` events, 15 s keep-alive, an ephemeral consumer per replica — the Viewer needs "latest" at once and to know when live is stale.
- 2026-11-20 — `status.viz-web` heartbeat and `pipeline.errors` for bad messages in M1; history endpoints and the read-only DB user in M3 — the user confirmed the M3 scope.
- 2026-11-20 — nats.js v3, `testcontainers` (Node), SSE hand-written on Fastify — maintained clients; the SSE format does not need a plugin.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | backend | [viz-web] Server: JetStream subscription to `trajectories.computed`, `GET /api/live` (SSE: `bus` and `trajectory` events, latest on connect, Last-Event-ID, keep-alive), `status.viz-web` heartbeat, `server/openapi.yaml` updated, Vitest tests with a fake bus and integration tests on NATS | contracts#1, foundations#7 | - |

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
