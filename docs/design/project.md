---
ready: yes
updated: 2026-11-20
---

# agent-team-demo-e2e — project design

## Product
A physics-based trajectory prediction demo, in vacuum, under gravity only (no
air drag). A point mass of a given mass, at a static position with height
above the ground >= 0, gets an upward force (elevation 0° < a < 90° above the
horizon, at a given azimuth) for a given burn duration, then flies
ballistically. The trajectory ends when the height returns to 0
(`end_reason = ground`), or at the configured propagation time if the mass
has not landed by then (`end_reason = time_limit`).

A request arrives with `POST /launches`. A pipeline of microservices over NATS
validates it, propagates the trajectory, stores it in PostgreSQL and publishes
it as ROS2 messages. A 3D web app shows it (live and historical views, play,
pause, rewind), and a control web app shows the status of the services,
starts and stops them, and changes their configuration. After an accepted
request, further requests are rejected with `429` for 5 minutes. Everything
runs on Kubernetes (minikube). All text in English.

It is a demo of an agent-built polyglot system: the value is an end-to-end
pipeline that is correct, observable and easy to run, not scale.

## Users and roles
| User type | Goals | Permissions |
|---|---|---|
| Operator (the only user) | send launches with curl or scripts, watch them in 3D, browse the history, start/stop services, change the config | everything, without authentication: the system is reachable only inside minikube and through its local ingress (`trajectory.local`) |
| control-web server (machine) | read and scale the pipeline deployments | a Kubernetes ServiceAccount whose RBAC allows only get/list/watch of deployments and pods and update of `deployments/scale`, in its namespace (M6) |

## Core flows
1. **Launch.** The operator sends `POST /launches`. api validates the format
   (422, `application/problem+json` listing every bad field). Within 300 s of
   the last accepted launch it answers 429, with `Retry-After` and the
   remaining seconds in the body. The window is global, its timestamp lives in
   a NATS JetStream KV bucket (it survives restarts, shared by replicas) and
   rejected requests do not restart it. Otherwise api assigns `launch_id`,
   attaches the propagation config snapshot, publishes `launches.accepted` and
   answers 202 with the id.
2. **Propagation.** propagator consumes `launches.accepted` and computes the
   exact piecewise analytic solution: constant force + gravity (g = 9.80665
   m/s², which also acts during the burn) for the burn, then pure ballistics.
   It samples every `sample_step_s`, adds the exact burn-end and ground-impact
   points, and publishes the whole trajectory at once on
   `trajectories.computed`. If the mass cannot lift off (z = 0 and
   F·sin(a) <= m·g), the trajectory ends at once with `end_reason = ground`:
   that is not an error.
3. **Storage.** store consumes `trajectories.computed`, writes the launch and
   its samples in one transaction, idempotent on `launch_id`, and publishes
   `trajectories.stored`.
4. **ROS2.** ros2-publisher consumes `trajectories.computed` and publishes it
   on ROS2 (topics and pacing: the ros2-publishing spec, M5; default: the
   whole trajectory at once, no real-time pacing). With no ROS2 network
   configured it stays up and reports `degraded` in its status.
5. **Live view.** The viz-web server subscribes to `trajectories.computed`
   (through `@albertoriorda95/trajectory-proto`) and pushes each trajectory to
   the browser over Server-Sent Events. "Live" is the latest computed
   trajectory, shown in the viewer. The user controls playback (play, pause,
   rewind, scrub, speed): nothing is forced to run in real time.
6. **History.** The viz-web server queries PostgreSQL with its own read-only
   DB user (a Secret separate from store's write credentials) and serves the
   list and the trajectories over REST.
7. **Control.** The control-web server shows per service the replicas
   (kubectl adapter, faked in CI) and the last `status.<service>` heartbeat
   ('unknown' after 15 s without one). It scales a pipeline deployment to 1
   (start) or 0 (stop), after a confirmation in the UI; PostgreSQL and NATS
   are read-only there. It sends config changes on `config.<service>.set`.
8. **Config.** Each service applies a `config.<service>.set` message, saves
   it to a local file so that it survives a restart, and confirms on
   `config.<service>.applied`. From M6 the JetStream stream is the single
   config source: replicas read the latest message at start-up, and the local
   file is a fallback.

Errors: every service publishes failures on `pipeline.errors` (launch_id,
service, message) and logs them as structured JSON; an invalid NATS message is
rejected and logged, never propagated. JetStream delivery is at least once,
and every consumer is idempotent on `launch_id`.

## Screens
| Screen | Purpose | Main components |
|---|---|---|
| viz-web: Viewer (one page) | watch the latest trajectory and the history in 3D | 3D scene (Three.js: ground grid, axes, trajectory polyline with the burn segment amber and the ballistic segment cyan, mass marker); timeline (play/pause, rewind to start, scrubber, speed 0.25×–4×); readout (t, position, velocity, height); Live/History switch; history list (date, parameters, flight time, range, max height); sample table as the text alternative of the 3D view. States: empty, loading, error, live disconnected |
| control-web: Control (one page) | see and drive the services | services table (name, replicas ready/desired, state from the heartbeat, Start/Stop with confirmation; PostgreSQL and NATS read-only), refreshed every 5 s; Config form per service with validation and Save: propagation time, sample step, ROS2 connection and topic names, DB table prefix, DB write credentials (write-only: never shown back) |

No launch form anywhere: launches come only from `POST /launches`.

## Domain model
| Entity | Key fields | Relations |
|---|---|---|
| LaunchRequest | mass_kg > 0; position {x_m, y_m, z_m >= 0}; azimuth_deg [0, 360); elevation_deg (0, 90) exclusive; force_n > 0; burn_duration_s > 0 | input of a Launch |
| PropagationConfig (snapshot) | propagation_time_s (default 60, max 3600), sample_step_s (default 0.01, range 0.001–1), gravity_mps2 = 9.80665, config version | copied into each Launch |
| Launch (table `<prefix>launches`) | id uuid, received_at, the request fields, the config snapshot, status (accepted, computed, stored, failed), end_reason (ground, time_limit), flight_time_s, max_height_m, range_m | has many Samples |
| Sample (table `<prefix>trajectory_samples`) | launch_id, seq, t_s, x/y/z_m, vx/vy/vz_mps, phase (burn, ballistic) | PK (launch_id, seq) |
| ServiceStatus (NATS only) | service, state (ok, degraded, down), detail, version, config version, sent_at | one per service, every 5 s |
| ServiceConfig (NATS + local file) | per service: propagator (propagation time, sample step), ros2-publisher (ROS2 connection, topic names), store (table prefix, DB write credentials, encrypted) | — |

Frame ENU, z up, origin on the ground; SI units everywhere. History is kept
forever. store owns the schema (Flyway) and is its only writer; a new table
prefix makes store create the tables at the next apply.

## API surface
The first version of the contract is in `docs/api/openapi.yaml`; the NATS
messages and subjects are in `proto/` (M1 contracts).
| Area | Endpoints |
|---|---|
| api (REST, `docs/api/openapi.yaml`) | `POST /launches` (202, 422, 429); `GET /healthz` |
| NATS subjects (`proto/`) | `launches.accepted`, `trajectories.computed`, `trajectories.stored`, `pipeline.errors`, `status.<service>`, `config.<service>.set`, `config.<service>.applied` |
| viz-web server (`services/viz-web/server/openapi.yaml`, M1/M3) | `GET /api/live` (SSE), `GET /api/launches` (paginated), `GET /api/launches/{id}/trajectory` |
| control-web server (`services/control-web/server/openapi.yaml`, M4) | `GET /api/services`, `POST /api/services/{name}/start`, `POST /api/services/{name}/stop`, `GET /api/config/{service}`, `PUT /api/config/{service}` |

## Integrations
- **NATS JetStream**: the bus. If it is down, api answers 503 to `POST
  /launches` and every service reports `down`/`degraded` and retries with
  backoff.
- **PostgreSQL**: written by store, read by the viz-web server. If it is
  down, store does not ack (the messages wait in JetStream) and the history
  view shows its error state.
- **ROS2 Jazzy**: optional at run time; without a ROS2 network the
  publisher stays up, `degraded`.
- **Kubernetes API**: used only by the control-web server through its
  kubectl adapter (a fake in CI and in compose).
- **GitHub Packages**: `@albertoriorda95/trajectory-proto` (0.1.0 in M1).

## Non-functional requirements
- From accepted (202) to visible in the live view in under 2 s on minikube.
- Desktop browsers: latest Chrome and Firefox, designed for 1280 px and up,
  usable down to 768 px.
- WCAG 2.2 AA for the controls and forms. The 3D view has a text readout
  and a sample table as its alternative.
- English only. Structured JSON logs in every service.
- Secrets: the DB write credentials are never in clear on a file or in a
  log. In transit they are encrypted for store only; at rest store keeps them
  encrypted in its local config file (key from a Secret, `STORE_CONFIG_KEY`),
  and from M6 the Kubernetes Secret is the source. The UI is write-only for
  them. The viz-web read-only user has its own Secret.
- Physics accuracy: the samples match the analytic solution to 1e-9 relative
  (double precision); the ground-impact time is exact (closed form).

## Design direction
Dark "mission control" theme: neutral greys, one cyan accent (ballistic
segment, primary actions), amber for the burn phase, red only for errors.
Inter for UI text, JetBrains Mono for numbers and readouts. Dense but calm:
data first, no decoration. Details in the design-system skill.

## Out of scope for now
- Air drag, wind, Earth rotation and curvature, variable gravity.
- Authentication and multiple users.
- A launch form in the web apps.
- Production deployment: only minikube.
- Mobile layouts below 768 px.

## Roadmap
| Milestone | Features (one spec each) |
|---|---|
| M0 Foundations | foundations (walking skeleton: every service starts, minimal compose with NATS + PostgreSQL, CI green) |
| M1 Contracts and ingestion | contracts (Protobuf schemas in `proto/`, `@albertoriorda95/trajectory-proto` 0.1.0 on GitHub Packages, the status message); launch-intake (api: POST /launches, 422, 429 with remaining time, NATS publish); viz-backend (viz-web server skeleton: NATS subscription, SSE) |
| M2 Propagation and persistence | propagation (C++ propagator, config saved to a local file, status on NATS); persistence (Java store to PostgreSQL, status on NATS) |
| M3 Visualization | viewer (Vue/Node 3D web app, live and history with the read-only DB user, play/pause/rewind) |
| M4 Control | control-panel (status, start/stop through a kubectl adapter faked in CI, config changes over the config queue) |
| M5 ROS2 | ros2-publishing (C++ ROS2 Jazzy publisher; stays up and reports it when no ROS2 network is configured) |
| M6 Kubernetes and verification | kubernetes-deployment (minikube manifests, replicas with load balancing, single config source, ServiceAccount for kubectl, DB credentials as Secrets); verification (the verification document, a team task, not a writer task) |
| Later | playback-interpolation; gazebo-scene |

The compose file of M0 grows with each milestone: every spec adds the services and settings it needs.

## Decisions
- 2026-11-20 — Polyglot monorepo: Python api, C++ propagator and ROS2 publisher, Java store, two Vue + Node web apps — given by the user (setup).
- 2026-11-20 — NATS JetStream as the bus, Protobuf messages in `proto/`, at-least-once with idempotent consumers on `launch_id` — one transport, replayable.
- 2026-11-20 — One user, no authentication; reachable only inside minikube — it is a local demo.
- 2026-11-20 — The propagation time is config, not a request field; 422 only for wrong format; no lift-off ends the trajectory at once (`ground`) — the caller describes the launch, the operator the simulation.
- 2026-11-20 — Global 300 s rate-limit window, fixed, kept in NATS KV; 429 with Retry-After and the remaining time — one launch at a time across replicas and restarts.
- 2026-11-20 — Exact piecewise analytic propagation, whole trajectory published at once — exact, deterministic, testable against closed forms.
- 2026-11-20 — "Live" = the latest computed trajectory, user-controlled playback; no forced real-time replay — the user explores it.
- 2026-11-20 — api only ingests; the viz-web server reads NATS (live, pushed by SSE) and PostgreSQL (history, own read-only user) — store stays the only writer of the schema.
- 2026-11-20 — Config over NATS (`config.<service>.set/applied`), saved per service to a local file; JetStream is the single source from M6 — matches the brief, survives restarts.
- 2026-11-20 — Status as a NATS heartbeat every 5 s plus replicas from the kubectl adapter; `/healthz` only for the Kubernetes probes — one status path for every language.
- 2026-11-20 — DB write credentials encrypted in transit and at rest, write-only in the UI — never in clear on a file or in a log.
- 2026-11-20 — Dark mission-control theme, cyan accent, amber burn, Inter + JetBrains Mono — readable numbers, a technical demo.

## Open questions
- (none)
