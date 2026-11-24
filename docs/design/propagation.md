---
feature: propagation
ready: yes
updated: 2026-11-24
owner: designer
milestone: M2
features: propagation
---

# Propagation: the C++ propagator

## Goal
The propagator turns every `LaunchAccepted` into the exact trajectory and
publishes it whole on `trajectories.computed`. It also owns the propagation
config: it applies `config.propagator.set` messages, saves them to a local
file and confirms them on `config.propagator.applied`, where api reads the
snapshot (launch-intake). It reports itself on `status.propagator`. Success: a
202 from api becomes a `TrajectoryComputed` on the `TRAJECTORIES` stream whose
samples match the closed-form solution to 1e-9 relative, and a config set by
hand with the `nats` CLI is in force after a restart.

## Out of scope
- Storing, ROS2 publishing, the live view (persistence, ros2-publishing, viewer).
- The UI that sends config (control-panel, M4): in M2 a config is sent with
  the `nats` CLI or by the tests.
- Reading the config from JetStream at start-up as the single source (M6).
- Replicas and load balancing (M6): the design must not prevent them (shared
  durable consumer), but M2 runs one instance.
- Air drag and every effect listed out of scope in `project.md`.

## User flows
1. **Launch computed.** propagator pulls a `LaunchAccepted` from its durable
   consumer on `launches.accepted`, validates it, computes the trajectory with
   the config snapshot carried in the message, publishes a
   `TrajectoryComputed` (JetStream, `Nats-Msg-Id` = launch_id), waits for the
   stream ack, then acks the input.
2. **Config applied.** A `ConfigSet` with a `propagator` payload arrives on
   `config.propagator.set`. propagator validates it (ranges, sample cap,
   version rule below), writes it to its local file atomically, puts it
   in force and publishes `ConfigApplied` (ok = true, the config in force).
   An invalid one: `ConfigApplied` ok = false with the reason, the config in
   force unchanged.
3. **Restart.** At start-up propagator reads its local file (none: the
   defaults, version 0), and publishes a `ConfigApplied` of the config in
   force, so that the `CONFIG` stream (where api reads the snapshot) holds
   it.
4. **Heartbeat.** Every 5 s a `ServiceStatus` on `status.propagator`: `ok`,
   or `degraded` with the reason (consumer missing, local file unwritable);
   `config_version` = the version in force.

Physics (from `project.md` and `docs/api/openapi.yaml`):
- Frame ENU, z up, origin on the ground. Force direction
  u = (cos e · sin az, cos e · cos az, sin e), az clockwise from north, e
  above the horizon. Acceleration during the burn a = F/m · u − g ẑ (gravity
  acts during the burn, constant mass); after it a = −g ẑ.
  g = `config.gravity_mps2` (9.80665).
- Phases: burn on [0, min(burn, end)], ballistic after. Both are constant
  acceleration: position and velocity in closed form, no integration.
- End: the first t > 0 with z = 0 (`END_REASON_GROUND`, exact root of the
  phase's quadratic), or t = `propagation_time_s` if the mass has not landed
  (`END_REASON_TIME_LIMIT`). The ground can be reached during the burn (start
  at z > 0 with F·sin e < m·g).
- No lift-off: z = 0 and F·sin e <= m·g: one sample at t = 0, `END_REASON_GROUND`,
  flight_time_s 0 (not an error).
- Sampling: t = k · sample_step_s for k = 0, 1, ... while
  t < end, plus the exact burn-end point (if before the end) and the end
  point; a point within 1e-9 s of a grid point replaces it (no duplicate).
  `seq` from 0 in time order. The burn-end point has `PHASE_BURN`, the points
  after it `PHASE_BALLISTIC`. The ground point has z = 0 exactly.
- Summary: `flight_time_s` = t of the end point; `max_height_m` = the
  highest z of the trajectory, from the closed form (the apex, not only the
  samples); `range_m` = horizontal distance from the launch position to the
  end point.

Edge and error cases:
- A `LaunchAccepted` that does not decode, has an empty `launch_id`, a
  missing request or config, or values out of the ranges of `openapi.yaml`
  and of the config (including the sample cap): terminated (no redelivery),
  logged, a `PipelineError` (service `propagator`, subject
  `launches.accepted`). Nothing is published on `trajectories.computed`.
- The same `LaunchAccepted` delivered twice: computed and published again;
  the result is identical (deterministic) and `Nats-Msg-Id` lets JetStream
  drop it within 2 min; later duplicates are absorbed by the consumers'
  idempotency.
- Publish not acked or NATS down: the input is not acked (nak with a delay),
  redelivered later; status `degraded`; reconnection with the foundations
  backoff. The process never exits because NATS is down.
- A config set while a launch is being computed: that launch keeps its
  snapshot (it is in the message).
- Local file unreadable or corrupt at start-up: log it, start with the
  defaults (version 0), status `degraded` with the reason until a valid set
  is applied.

## Screens and states
None (no UI).

## Data and API
Messages: `trajectory.v1` as it is (`LaunchAccepted`, `TrajectoryComputed`,
`PipelineError`, `ServiceStatus`, `ConfigSet`/`ConfigApplied` with
`PropagatorConfig`). No proto change.

Config version: a `ConfigSet` with a `config_version` higher than the one in
force is applied; the same version is acknowledged again (`ok` = true, no
change); a lower one gets `ok` = false, error `stale version`, the config in
force unchanged.

Config validation: `propagation_time_s` in (0, 3600], `sample_step_s` in
[0.001, 1], `propagation_time_s / sample_step_s <= 100000`, finite numbers;
`service` = `propagator` and the payload `propagator` set.

Local file: JSON `{"config_version", "propagation_time_s", "sample_step_s"}`
at `PROPAGATOR_CONFIG_PATH` (default `/var/lib/propagator/config.json`),
written to a temporary file and renamed (never half written).

NATS objects: durable pull consumer `propagator` on the `LAUNCHES` stream,
filter `launches.accepted`, explicit ack, ack wait 30 s, shared by the
replicas (M6). Config: a subscription to `config.propagator.set` per instance
(every replica applies every config), delivering only new messages; M6
changes it to "the latest message of the stream at start-up".

Environment: `NATS_URL` (existing), new `PROPAGATOR_CONFIG_PATH`.

Logs: one JSON line per launch (launch_id, outcome, samples, duration) and
per config set (version, ok).

Breaking for existing clients: no

## Acceptance criteria
- [ ] Unit: for a set of launches (vertical-ish, shallow, start at z > 0, no lift-off, burn longer than the propagation time, landing during the burn) every sample matches the closed form to 1e-9 relative; the ground point has z = 0 and its time equals the quadratic root; burn-end and end points are present once.
- [ ] Unit: the no-lift-off launch gives one sample, `END_REASON_GROUND`, flight time 0.
- [ ] Unit: the defaults (60 s, 0.01 s) on a launch that does not land give 6001 samples and `END_REASON_TIME_LIMIT` (plus the burn-end point when it is off the grid).
- [ ] Integration (real NATS): a `LaunchAccepted` published on `launches.accepted` produces one `TrajectoryComputed` with the same launch_id, request and config, `Nats-Msg-Id` = launch_id, and the input is acked.
- [ ] Integration: an invalid `LaunchAccepted` produces a `PipelineError` and no trajectory, and is not redelivered.
- [ ] Integration: a valid `ConfigSet` produces `ConfigApplied` ok = true, the file holds it, and after a restart of the service the next heartbeat carries its version; an invalid one produces ok = false and the config in force is unchanged.
- [ ] `status.propagator` receives a heartbeat every 5 s (± 1 s).
- [ ] With compose: `POST /launches` then `nats stream view TRAJECTORIES` shows the trajectory within 2 s.

## Test seams
- Library: `propagator::propagate(request, config)` (pure function, GoogleTest) against closed forms: catches the physics, sampling, end and summary rules; misses NATS and Protobuf.
- Config module: `validate` and the local-file load/save (GoogleTest, temp dir): catches ranges, the cap, atomic writes and corrupt files; misses the NATS flow.
- Integration: the service's message handlers against a real NATS with JetStream and the `proto/nats/streams/` definitions applied (ctest, `NATS_TEST_URL`; the CI `propagator` job starts the server; locally `docker compose up nats nats-init`): catches consume, publish, ack, term, errors, config set/applied and the heartbeat; misses compose wiring.

## Reuse
- NATS client: `cnats` 3.14.0 (Conan), from foundations.
- Protobuf runtime for C++: `protobuf` from ConanCenter at the version matching the generated code (v33.1, `proto/README.md`); the generated C++ code is committed in the service as api does for Python (generated with the service's own `buf.gen.yaml`).
- JSON for the local file: `nlohmann_json` from ConanCenter (MIT, header-only), a new dependency; the existing log writer stays.
- Physics: written here (closed forms; no library needed).

## Decisions
- 2026-11-24 — Closed-form constant-acceleration phases, exact roots for the ground point — project.md (exact, deterministic, testable).
- 2026-11-24 — A launch is computed with the config snapshot of its `LaunchAccepted`, not the config in force — deterministic and replayable; the propagator's config only feeds `config.propagator.applied`, which api reads.
- 2026-11-24 — Grid samples plus the exact burn-end and end points (a point within 1e-9 s of a grid point replaces it); max height from the closed-form apex, range horizontal to the end point — exact summaries, no duplicate times.
- 2026-11-24 — Config versions: higher applied, equal re-acknowledged, lower rejected as stale — a late old message cannot overwrite a newer config.
- 2026-11-24 — At start-up: the local file (or the defaults, v0) and a `ConfigApplied` of it; each instance subscribes to new `config.propagator.set` messages — the file is the source until M6.
- 2026-11-24 — The C++ integration tests use a NATS server started by the CI job (`NATS_TEST_URL`) — no Testcontainers in C++ here; tests stay simple.
- 2026-11-24 — `nlohmann_json` (MIT) for the local config file — a trusted header-only library instead of a hand-written parser.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | backend | [propagator] The physics library `propagate(request, config)` with the sampling, end and summary rules, the committed generated C++ code of `trajectory.v1` and the protobuf runtime (Conan), GoogleTest against closed forms | — | - |
| 2 | devops | [repo] CI `propagator` job: a NATS server with JetStream (pinned image) and the streams of `proto/nats/streams/` applied, `NATS_TEST_URL` set for ctest; compose: a named writable volume for `PROPAGATOR_CONFIG_PATH` of the propagator | — | - |
| 3 | backend | [propagator] The pipeline: durable consumer on `launches.accepted`, publish of `TrajectoryComputed` with the ack, term and `PipelineError` for invalid input, `status.propagator` heartbeat, integration tests on NATS | 1, 2 | - |
| 4 | backend | [propagator] The config: `config.propagator.set` validated with the version rule, saved atomically to `PROPAGATOR_CONFIG_PATH` (`nlohmann_json`), `config.propagator.applied`, start-up from the file with its `ConfigApplied`, unit and integration tests | 3 | - |

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
