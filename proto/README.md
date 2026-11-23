# proto

The Protobuf messages that the services exchange on NATS, the subjects they
are published on and the JetStream streams that keep them. This folder is the
contract: backend changes it before or together with the code (`AGENTS.md` >
API contract). The design is `docs/design/contracts.md`.

## Layout
One buf module (`buf.yaml` at the repository root), one folder per package
and version: `proto/<package>/v<N>/*.proto`.

| Package | Status | Files |
|---|---|---|
| `trajectory.v1` | the pipeline messages (M1 contracts) | `launch.proto` (`Position`, `LaunchRequest`, `PropagationConfig`, `LaunchAccepted`), `trajectory.proto` (`Sample`, `TrajectoryComputed`, `TrajectoryStored`), `service.proto` (`PipelineError`, `ServiceStatus`), `config.proto` (`PropagatorConfig`, `ConfigSet`, `ConfigApplied`) |
| `demo.v1` | deprecated placeholder (foundations), removed by a later contract task once nothing uses it | `ping.proto` (`Ping`) |

Conventions of `trajectory.v1`: SI units, frame ENU (x east, y north, z up,
origin on the ground), times as `google.protobuf.Timestamp`, numbers as
`double`. Every enum has a `*_UNSPECIFIED = 0` that is never sent.

## Encoding
- Every message on NATS is the binary Protobuf encoding of the type in the
  table below (no JSON, no envelope). Consumers decode it with the generated
  type of their language.
- A message that does not decode, or decodes with a required value missing
  (an empty `launch_id`, an enum at `*_UNSPECIFIED`), is rejected: the
  consumer terminates it (no redelivery), logs it and publishes a
  `PipelineError`. It is never passed on.
- `Nats-Msg-Id`: the publishers of `launches.accepted`,
  `trajectories.computed` and `trajectories.stored` set the `Nats-Msg-Id`
  header to the `launch_id`, so JetStream drops a duplicate within the
  stream's duplicate window (2 min). Consumers are idempotent on `launch_id`
  all the same. `pipeline.errors`, `config.*` and `status.*` carry no
  `Nats-Msg-Id` (several errors or configs can share a launch or a service).
- Sample cap: `propagation_time_s / sample_step_s <= 100000` (about 7 MB per
  `TrajectoryComputed`; the defaults give 6000 samples). NATS `max_payload` is
  8 MB. The cap is checked wherever the config is set (control-panel, M4).

## NATS subjects
Service names on the subjects: `api`, `propagator`, `ros2-publisher`,
`store`, `viz-web`, `control-web`. `<service>` below is one of them.

| Subject | Message | Publisher | Consumers | Stream |
|---|---|---|---|---|
| `launches.accepted` | `trajectory.v1.LaunchAccepted` | api | propagator, viz-web | `LAUNCHES` |
| `trajectories.computed` | `trajectory.v1.TrajectoryComputed` | propagator | store, ros2-publisher, viz-web | `TRAJECTORIES` |
| `trajectories.stored` | `trajectory.v1.TrajectoryStored` | store | none yet | `TRAJECTORIES` |
| `pipeline.errors` | `trajectory.v1.PipelineError` | every service | none yet (kept for diagnosis) | `ERRORS` |
| `status.<service>` | `trajectory.v1.ServiceStatus` | every service, every 5 s | control-web | none (core NATS) |
| `config.<service>.set` | `trajectory.v1.ConfigSet` | control-web | `<service>` | `CONFIG` |
| `config.<service>.applied` | `trajectory.v1.ConfigApplied` | `<service>` | control-web | `CONFIG` |

The TypeScript constants of these subjects are in
`libs/trajectory-proto/src/subjects.ts` (tested against this table); the other
languages keep their own constants, taken from this table.

## Streams
Defined as JSON (the JetStream stream config, as `nats stream add --config`
reads it) in `proto/nats/streams/<NAME>.json`, applied by `nats-init` before
the services start (compose; Kubernetes in M6). Durable consumers are created
by each consuming service, not here.

| Stream | Subjects | Retention |
|---|---|---|
| `LAUNCHES` | `launches.>` | limits, max age 7 days, duplicate window 2 min |
| `TRAJECTORIES` | `trajectories.>` | limits, max age 7 days, duplicate window 2 min |
| `ERRORS` | `pipeline.errors` | limits, max age 7 days |
| `CONFIG` | `config.>` | max 1 message per subject (the latest), no max age |

`status.*` is core NATS, no stream: a heartbeat has no value once old.

Apply them by hand (with the `nats` CLI, for example in `natsio/nats-box`):
`for f in proto/nats/streams/*.json; do nats stream add --config "$f"; done`,
then `nats stream info <NAME>`.

## Commands (from the repository root)
- `npx buf lint`: the `STANDARD` rules.
- `npx buf breaking --against '.git#branch=main'`: the `FILE` rules (CI runs it
  on every pull request).
- `npx buf generate`: the code of every message in `gen/` (ignored by Git):
  `gen/python` (`*_pb2.py` and `.pyi`), `gen/cpp` (`*.pb.h`, `*.pb.cc`),
  `gen/java`, `gen/ts`. The Python, C++ and Java plugins are buf remote
  plugins pinned to protobuf v33.1 (network access to buf.build needed): a
  service that uses the generated code links the protobuf runtime of that
  version.
- TypeScript for the web apps: the package `@albertoriorda95/trajectory-proto`
  in `libs/trajectory-proto/` (`npm run build -w libs/trajectory-proto`).
