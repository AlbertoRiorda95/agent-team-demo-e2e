---
feature: launch-intake
ready: yes
updated: 2026-11-20
owner: designer
milestone: M1
features: launch-intake
---

# Launch intake: POST /launches

## Goal
The operator sends `POST /launches` with curl or a script. api checks the
format, enforces the global 5-minute window, and publishes the accepted
launch on `launches.accepted` with its config snapshot. Success: a valid
request gets 202 and its `LaunchAccepted` is on the `LAUNCHES` stream; a bad
one gets 422 with every bad field; a second one within 300 s gets 429 with
the remaining time; with NATS down, 503 and nothing accepted.

## Out of scope
- Status and history reads over REST (the viewer reads the history, M3).
- Propagation, storage and anything after `launches.accepted`.
- Changing the propagation config (control-panel, M4).
- A per-client limit: the window is global.

## User flows
1. **Accepted.** Valid body, no launch accepted in the last 300 s: api claims
   the window, assigns a `launch_id` (UUID v4) and `accepted_at`, attaches
   the config snapshot, publishes `LaunchAccepted` on `launches.accepted`
   (JetStream, `Nats-Msg-Id` = launch_id), waits for the stream ack, answers
   202 `{launch_id, accepted_at}`.
2. **Invalid.** Wrong JSON, missing or extra field, wrong type, value out of
   range, non-finite number: 422 `application/problem+json` with one entry
   per bad field (JSON pointer). The window is not checked nor touched.
3. **Rate-limited.** Valid body, a launch accepted less than 300 s ago: 429,
   `Retry-After` and `retry_after_s` = the remaining seconds rounded up
   (>= 1). The window is not restarted.
4. **Bus down.** NATS unreachable or the publish not acked: 503 problem,
   nothing accepted, the window left as it was before the request.

Edge cases:
- Two valid requests at the same time on two replicas: exactly one gets 202,
  the other 429 (atomic claim).
- A valid request at exactly 300 s after the last accept: accepted.
- An invalid request inside the window: 422 (format first), not 429.
- api restarts inside the window: the window still holds (it lives in NATS).
- The config snapshot is out of the sample cap (contracts): cannot happen
  with the defaults; the config is validated where it is set (M4).

## Screens and states
None (REST only).

## Data and API
Contract: `docs/api/openapi.yaml` as it is (202, 422, 429 with `Retry-After`
and `retry_after_s`, 503). No change.

Window: a KV bucket `launch_window` that api creates at
start-up if missing (TTL = the window, 300 s; history 1), key `last`. A
request claims the window with an atomic `create` of `last` (fails if the key
exists); the remaining time comes from the entry's server timestamp, so the
replicas' clocks do not matter. If the publish then fails, api deletes `last`
and answers 503. `LAUNCH_WINDOW_S` (default 300) changes the window, for
tests only.

Config snapshot: at each accepted request api reads the
latest `config.propagator.applied` on the `CONFIG` stream (it carries the
config in force); none, or not `ok`: the defaults (propagation_time_s 60,
sample_step_s 0.01, version 0). gravity_mps2 is always 9.80665.

Status: `ServiceStatus` on `status.api` every 5 s (`ok`, or
`degraded` with the reason while the KV bucket is missing). api publishes
nothing on `pipeline.errors`: its failures are the HTTP answer.

Logs: one structured JSON line per request (launch_id or none, outcome,
status code, duration).

Breaking for existing clients: no

## Acceptance criteria
- [ ] A valid request answers 202 with a UUID and `accepted_at`; the `LAUNCHES` stream holds one `LaunchAccepted` with the same id, the request values and the default config (version 0).
- [ ] A second valid request within the window answers 429 with `Retry-After` equal to `retry_after_s`, between 1 and 300, decreasing over time; the stream still holds one message.
- [ ] A request with three bad fields answers 422 listing the three JSON pointers; nothing is published, the window is unchanged.
- [ ] After the window (`LAUNCH_WINDOW_S=2` in the test) a new request is accepted.
- [ ] Two concurrent valid requests against two app instances on the same NATS: one 202, one 429.
- [ ] With NATS stopped: 503 problem, `/healthz` 503 `degraded`; after NATS returns, a request is accepted without restarting api.
- [ ] `status.api` receives a heartbeat every 5 s (± 1 s).
- [ ] Every response matches `docs/api/openapi.yaml` (contract test).

## Test seams
- API: `POST /launches` through the FastAPI test client with a fake bus and a fake clock: catches validation, status codes, problem bodies and the window logic; misses real NATS behavior.
- Integration: the same endpoint against a real NATS (Testcontainers) with the `proto/nats/streams/` definitions applied: catches the KV claim, the publish, the ack, concurrency and recovery; misses compose and Kubernetes wiring.
- Contract: responses checked against `docs/api/openapi.yaml` (openapi-core, from foundations): catches contract drift.

## Reuse
- FastAPI, pydantic, nats-py (KV and JetStream), openapi-core: from foundations.
- Generated Python types of `trajectory.v1` (contracts#1), never hand-written.
- Integration tests: `testcontainers` for Python (Apache-2.0) with a NATS container.

## Decisions
- 2026-11-20 — Global fixed 300 s window in NATS KV, rejected requests do not restart it, 429 with Retry-After and remaining seconds — project.md.
- 2026-11-20 — Format checked before the window — a bad request should say what is wrong, not "wait".
- 2026-11-20 — The window is an atomic `create` in a KV bucket with TTL, remaining time from the server timestamp, key deleted if the publish fails — exactly one winner across replicas, no clock skew, no window lost on a failed publish.
- 2026-11-20 — The config snapshot is the latest `config.propagator.applied` on `CONFIG`, defaults when none — control-panel (M4) changes nothing in api.
- 2026-11-20 — `status.api` heartbeat from M1; nothing on `pipeline.errors` from api — its failures are the HTTP answer and have no launch_id.
- 2026-11-20 — `testcontainers` (Python) for the NATS integration tests — the KV claim and the ack need a real server.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | backend | [api] Real `POST /launches`: the KV window (`launch_window`), the config snapshot, publish of `LaunchAccepted` with the ack, 503 on bus failure, `status.api` heartbeat, unit tests with a fake bus and integration tests on NATS (Testcontainers) | contracts#1, foundations#3 | - |

## Readiness checklist
- [x] goal, users and out of scope agreed
- [x] every flow has its error and edge cases
- [x] every screen has empty, loading, error and success states (no UI)
- [x] contract changes written, breaking changes approved by the user (none)
- [x] acceptance criteria are observable
- [x] test seams agreed
- [x] reuse decided: team libraries and new dependencies named, or "none"
- [x] task breakdown with roles and dependencies
- [x] no open questions
