---
feature: contracts
ready: yes
updated: 2026-11-20
owner: designer
milestone: M1
features: contracts
---

# Contracts: the NATS messages and the proto library

## Goal
Every service of the pipeline talks over NATS with the same typed messages.
`proto/` defines them (package `trajectory.v1`), `proto/README.md` documents
the subjects, the streams and the encoding, and
`@albertoriorda95/trajectory-proto` 0.1.0 ships the TypeScript types and the
subject names on GitHub Packages. After this, launch-intake, viz-backend and
the M2 services build on generated types only, and `npx buf breaking` guards
the contract.

## Out of scope
- Any service behavior: publishing and consuming are the features that use
  the messages (launch-intake, viz-backend, M2 onwards).
- The payloads of the store and ros2-publisher config (persistence M2,
  ros2-publishing M5, added as new fields: not breaking).
- The encryption of the DB write credentials (persistence M2 /
  control-panel M4): here only an opaque `bytes` field.
- The ROS2 messages (`services/ros2-publisher/msg/`, M5).
- Removing `demo.v1.Ping`: a later contract task, once nothing uses it.

## User flows
1. A backend developer edits `proto/`, runs `npx buf generate`: Python, C++,
   Java and TypeScript code is regenerated; `npx buf lint` and `npx buf
   breaking --against '.git#branch=main'` pass.
2. A service publishes a message on its subject as binary Protobuf; every
   consumer decodes it with the generated type.
3. After contracts#1 is merged the user pushes the tag `v0.1.0`;
   `publish.yml` publishes `@albertoriorda95/trajectory-proto` 0.1.0. Agents
   never tag.
4. `docker compose up` creates the JetStream streams (`nats-init`) before the
   services start.

Edge and error cases:
- A message that does not decode, or decodes with a required value missing
  (empty `launch_id`, enum `*_UNSPECIFIED`): the consumer rejects it (term,
  no redelivery), logs it, publishes a `PipelineError`; it is never passed on.
- The same message delivered twice: consumers are idempotent on `launch_id`;
  publishers set the `Nats-Msg-Id` header to `launch_id` so JetStream drops
  duplicates within its window.
- A trajectory over the payload limit: prevented by the sample cap below.

## Screens and states
None (no UI).

## Data and API
Package `trajectory.v1`, files in `proto/trajectory/v1/`. SI units, frame ENU
(z up, origin on the ground), times as `google.protobuf.Timestamp`, numbers as
`double`. Every enum has a `*_UNSPECIFIED = 0`, never sent.

| Message | Fields | Subject |
|---|---|---|
| `Position` | x_m, y_m, z_m | — |
| `LaunchRequest` | mass_kg, position, azimuth_deg, elevation_deg, force_n, burn_duration_s (as `docs/api/openapi.yaml`) | — |
| `PropagationConfig` | propagation_time_s, sample_step_s, gravity_mps2, config_version (uint64; 0 = the defaults) | — |
| `LaunchAccepted` | launch_id (uuid string), accepted_at, request, config | `launches.accepted` |
| `Sample` | seq (uint32, from 0), t_s, x_m, y_m, z_m, vx_mps, vy_mps, vz_mps, phase (`PHASE_BURN`, `PHASE_BALLISTIC`) | — |
| `TrajectoryComputed` | launch_id, accepted_at, computed_at, request, config, end_reason (`END_REASON_GROUND`, `END_REASON_TIME_LIMIT`), flight_time_s, max_height_m, range_m, repeated samples | `trajectories.computed` |
| `TrajectoryStored` | launch_id, stored_at, sample_count | `trajectories.stored` |
| `PipelineError` | launch_id (empty when unknown), service, subject (where it happened), message, occurred_at | `pipeline.errors` |
| `ServiceStatus` | service, instance (host/pod name), state (`STATE_OK`, `STATE_DEGRADED`, `STATE_DOWN`), detail, version, config_version, sent_at | `status.<service>`, every 5 s |
| `ConfigSet` | service, config_version, oneof payload { `PropagatorConfig` propagator } (store and ros2 payloads added later) | `config.<service>.set` |
| `PropagatorConfig` | propagation_time_s, sample_step_s | — |
| `ConfigApplied` | service, instance, config_version, ok, error, applied_at, the same oneof payload (the config now in force) | `config.<service>.applied` |

Service names on the subjects: `api`, `propagator`, `ros2-publisher`,
`store`, `viz-web`, `control-web`.

Sample cap: `propagation_time_s / sample_step_s <= 100000` (about 7 MB per
trajectory, defaults 6000 samples); NATS `max_payload` 8 MB. The cap is
checked wherever the config is set (control-panel, M4).

Streams, defined as JSON in `proto/nats/streams/`, documented in
`proto/README.md`, applied by `nats-init` (compose; Kubernetes in M6):
| Stream | Subjects | Retention |
|---|---|---|
| `LAUNCHES` | `launches.>` | limits, max age 7 days, duplicate window 2 min |
| `TRAJECTORIES` | `trajectories.>` | limits, max age 7 days, duplicate window 2 min |
| `ERRORS` | `pipeline.errors` | limits, max age 7 days |
| `CONFIG` | `config.>` | max 1 message per subject (the latest), no max age |
`status.*` is core NATS (no stream): a heartbeat has no value once old.
Durable consumers are created by each consuming service, not here.

`demo.v1.Ping`: marked `deprecated`, kept until nothing uses it.

Library `@albertoriorda95/trajectory-proto` 0.1.0 exports:
- the protobuf-es generated messages of `trajectory.v1`;
- the NATS subject names as constants (`LAUNCHES_ACCEPTED`,
  `TRAJECTORIES_COMPUTED`, `TRAJECTORIES_STORED`, `PIPELINE_ERRORS`) and
  functions for the per-service ones (`statusSubject(service)`,
  `configSetSubject(service)`, `configAppliedSubject(service)`) over a
  `ServiceName` union of the six names, hand-written in `src/subjects.ts`
  and tested against the subject table of `proto/README.md`. The
  non-TypeScript services keep their own constants, taken from that table.
`proto/README.md` stays the human documentation of the subjects.

Contract changes: new messages, `proto/README.md`, `proto/nats/streams/`;
`docs/api/` unchanged.
Breaking for existing clients: no (additions only; Ping only deprecated).

## Acceptance criteria
- [ ] `npx buf lint` and `npx buf breaking --against '.git#branch=main'` pass.
- [ ] `npx buf generate` produces the `trajectory.v1` code for Python, C++, Java and TypeScript; each service's build still passes.
- [ ] `proto/README.md` lists every subject with its message, publisher, consumers, stream, and the `Nats-Msg-Id` rule.
- [ ] `npm test -w libs/trajectory-proto`: a `TrajectoryComputed` with 100000 samples round-trips binary and JSON (proto field names) unchanged, and its binary size is under 8 MB.
- [ ] The package exports the subject constants and functions; a test checks that they equal the subjects of the table in `proto/README.md` (`statusSubject("store") === "status.store"`).
- [ ] `docker compose up` creates the four streams with the settings of the table (`nats stream info` shows them) before any service starts.
- [ ] `libs/trajectory-proto/package.json` has version 0.1.0 and `npm pack --dry-run` lists only the build output.

## Test seams
- Library: the package's public exports with Vitest (round-trip, size of the largest trajectory, subject names against `proto/README.md`): catches generation, packaging, the size budget and drift between constants and docs; misses the other languages.
- Contract: `buf lint` and `buf breaking` in CI: catches incompatible edits; misses semantic changes of a field.
- Streams: `docker compose up` then `nats stream info` in the compose smoke check: catches missing or wrong streams; misses consumer settings.

## Reuse
- Generation: buf CLI (`@bufbuild/buf`) and protobuf-es, already chosen in foundations.
- Well-known types: `google/protobuf/timestamp.proto` (bundled with protobuf).
- Stream provisioning: the `nats` CLI in the `natsio/nats-box` image (Apache-2.0), pinned by digest.

## Decisions
- 2026-11-20 — Binary Protobuf on NATS, one package `trajectory.v1` — given by project.md; versioned package for future breaking changes.
- 2026-11-20 — The whole trajectory in one `TrajectoryComputed`, capped at 100000 samples, NATS `max_payload` 8 MB — one message as project.md says, within NATS limits; chunks or Object Store would complicate every consumer.
- 2026-11-20 — Four JetStream streams defined in `proto/nats/streams/` and applied by a `nats-init` service; `status.*` on core NATS — one place for stream settings, no service can disagree on them.
- 2026-11-20 — Config envelopes and the propagator payload now; store and ros2 payloads added by M2 and M5; credentials as opaque `bytes` — only what is decided today, additions are not breaking.
- 2026-11-20 — `demo.v1.Ping` deprecated, removed later — removing it now would break the foundations skeletons and `buf breaking`.
- 2026-11-20 — The library exports the generated types and the subject names; the user pushes `v0.1.0` after contracts#1 — services and web apps share the subjects from the package; agents never tag.
- 2026-11-20 — Subject constants hand-written in the library's `src/subjects.ts`, tested against `proto/README.md`; other languages keep their own constants from that table — six names do not justify a custom proto option read in four languages.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | backend | [proto] The `trajectory.v1` messages, `proto/README.md` (subjects, streams, encoding, `Nats-Msg-Id`), the stream definitions in `proto/nats/streams/`, `demo.v1.Ping` deprecated, regenerated code, `@albertoriorda95/trajectory-proto` 0.1.0 exporting the types and the subject constants, with its Vitest round-trip, size and subject tests | foundations#2 | - |
| 2 | devops | [repo] NATS `max_payload` 8 MB and a `nats-init` service in `compose.yml` (nats-box pinned by digest) that applies `proto/nats/streams/` before the services start | 1, foundations#11 | - |

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
