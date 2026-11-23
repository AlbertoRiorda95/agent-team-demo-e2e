# Interface Control Document (ICD)

Written against: `c974dc8` (2026-11-23)

For integrators: how to talk to the system and how its parts talk to each
other. It describes what the code at that commit does. The product design is
`docs/design/project.md`; the contracts are the files named in each section.
The generated code reference is not here: the CI builds it (artifact
`reference-docs`).

## 1. State of the interfaces at this commit

The repository is at the "foundations" stage: every service starts, but most
interfaces of the design are not implemented yet. Read this table first.

| Interface | Design | Implemented at `c974dc8` |
|---|---|---|
| REST `POST /launches` (api) | 202, 422, 429, 503 | 202 and 422 only. The 202 does not publish anything and there is no rate limit (no 429, no 503) |
| REST `GET /healthz` (api) | 200 / 503 | yes |
| NATS subjects and streams | `trajectory.v1`, 7 subjects, 4 streams | none. Only the placeholder `demo.v1.Ping` exists, on no subject |
| Service status and config on NATS | heartbeat every 5 s, `config.<service>.set/applied` | no |
| viz-web server API | `/api/live`, `/api/launches`, ... | `GET /healthz` only |
| control-web server API | `/api/services`, `/api/config/{service}`, ... | `GET /healthz` only |
| Database schema | launches and samples tables | empty baseline (`V1__baseline.sql`: `SELECT 1`) |
| ROS2 messages (`services/ros2-publisher/msg/`) | M5 | the folder does not exist |
| Kubernetes (`deploy/k8s/`) | M6 | the folder does not exist; only `compose.yml` |

Sections 3 to 9 document what exists, and say in each what is still missing.

## 2. System overview

```
curl / scripts --HTTP--> api --NATS--> propagator --NATS--> store --SQL--> PostgreSQL
                                                  \--NATS--> ros2-publisher --ROS2--> ROS2 network
browser --HTTP/SSE--> viz-web server --NATS, SQL (read only)
browser --HTTP--> control-web server --Kubernetes API, NATS
```

This is the designed flow (`docs/design/project.md`). At this commit only the
links "curl to api" and the connections of each service to NATS (and of store
to PostgreSQL) exist; no message travels on them.

Interface identifiers used below:

| Id | From | To | Protocol | Section |
|---|---|---|---|---|
| IF-1 | operator, scripts | api | HTTP/JSON | 3 |
| IF-2 | api, propagator, ros2-publisher, store, viz-web, control-web | NATS | NATS (binary Protobuf) | 4 |
| IF-3 | store | PostgreSQL | JDBC / SQL | 5 |
| IF-4 | viz-web server | PostgreSQL | SQL, read only | 5 |
| IF-5 | viz-web UI | viz-web server | HTTP | 6 |
| IF-6 | control-web UI | control-web server | HTTP | 7 |
| IF-7 | ros2-publisher | ROS2 network | ROS2 (DDS) | 8 |
| IF-8 | control-web server | Kubernetes API | kubectl adapter | 9 |
| IF-9 | build and CI | GitHub Packages | npm | 10 |

## 3. IF-1: the launch API (api)

Contract: `docs/api/openapi.yaml` (version 0.1.0). Server: `services/api/`.

### 3.1 Transport
- HTTP, no TLS, no authentication (the system is local, see the design).
- Address: `http://localhost:8000` (compose publishes `127.0.0.1:${API_PORT:-8000}`);
  the contract also lists `http://trajectory.local` for the Kubernetes ingress (not yet
  deployed).
- Request body: `application/json`. Success responses: `application/json`.
  Errors: `application/problem+json` (RFC 9457 shape).
- The service serves no OpenAPI document and no `/docs` page: the contract is the file.
- Units SI; frame ENU, z up, origin on the ground; azimuth clockwise from north.

### 3.2 `POST /launches`

Request (`LaunchRequest`, no field may be missing, no other field is allowed):

| Field | Type | Rule |
|---|---|---|
| `mass_kg` | number | > 0 |
| `position.x_m` | number | any |
| `position.y_m` | number | any |
| `position.z_m` | number | >= 0 |
| `azimuth_deg` | number | 0 <= value < 360 |
| `elevation_deg` | number | 0 < value < 90 |
| `force_n` | number | > 0 |
| `burn_duration_s` | number | > 0 |

Numbers must be JSON numbers: strings, booleans, `NaN` and infinity are
rejected. Integers are accepted as numbers.

Responses:

| Status | Body | When |
|---|---|---|
| 202 | `{"launch_id": "<uuid>", "accepted_at": "<RFC 3339 UTC>"}` | the request is valid |
| 422 | `application/problem+json`, see below | wrong format or a value out of range |
| 429 | Problem with `retry_after_s`, header `Retry-After` | contract only: **not implemented** |
| 503 | Problem | contract only: **not implemented** |

Worked example (checked against the code in a test client; the id and time differ per call):

```sh
curl -s -X POST http://localhost:8000/launches \
  -H 'Content-Type: application/json' \
  -d '{"mass_kg":1,"position":{"x_m":0,"y_m":0,"z_m":0},"azimuth_deg":0,"elevation_deg":45,"force_n":10,"burn_duration_s":1}'
```
```json
{"launch_id":"ec105968-786a-434b-a552-7ad2c39bc2ab","accepted_at":"2026-11-23T15:38:47.220630Z"}
```

At this commit a 202 means only "the request is valid": nothing is published
on NATS, nothing is stored, and the next request is accepted at once.

### 3.3 Errors (422)

The body lists every bad field:

```json
{
  "type": "about:blank",
  "title": "Invalid launch request",
  "status": 422,
  "detail": "The request has a wrong format or a value out of range.",
  "errors": [
    {"field": "/mass_kg", "message": "Input should be greater than 0"},
    {"field": "/extra", "message": "Extra inputs are not permitted"}
  ]
}
```

- `field` is a JSON pointer (RFC 6901) into the body, for example `/position/z_m`.
- A body that is not valid JSON gives one error with `field` `""` and message `JSON decode error`.
- `message` is the text of the validation library (pydantic): it is for people, do not parse it.

Other errors come from the framework, not from the contract, and have another
shape: an unknown path answers `404` with `{"detail":"Not Found"}`; a wrong
method answers `405` with `{"detail":"Method Not Allowed"}` and an `Allow` header.

### 3.4 `GET /healthz`

| Status | Body | Meaning |
|---|---|---|
| 200 | `{"status":"ok"}` | connected to NATS |
| 503 | `{"status":"degraded"}` | not connected to NATS, or `NATS_URL` not set |

The service never exits because NATS is down: it retries the connection with
exponential backoff (0.5 s doubling up to 30 s) and reconnects forever once
connected. It is meant for the container and Kubernetes probes.

### 3.5 Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `NATS_URL` | none | NATS server, for example `nats://nats:4222`. Unset: the service stays `degraded` |
| `API_HOST` | `127.0.0.1` | listen address (compose sets `0.0.0.0`) |
| `API_PORT` | `8000` | listen port, 1 to 65535; an invalid value stops the service at start-up |

Logs: one structured JSON object per line.

## 4. IF-2: NATS

Contract: `proto/` and `proto/README.md`. Server: NATS 2 with JetStream
(`compose.yml`), client port 4222, monitoring port 8222.

### 4.1 What exists
- The package `demo.v1` with one placeholder message, `Ping`
  (`proto/demo/v1/ping.proto`): `string message = 1; int64 sent_at_ms = 2;`.
  It is used on no subject and it is meant to be removed.
- `proto/README.md` lists no subject: "the subjects come with the M1 contracts".
- Code is generated for Python, C++, Java and TypeScript with `npx buf generate`
  (protobuf runtime v33.1).

### 4.2 What every service does with NATS today
Each service reads `NATS_URL`, connects at start-up, and keeps retrying with
backoff while NATS is down. None publishes or subscribes.

| Service | Variable | Default | If NATS is down |
|---|---|---|---|
| api | `NATS_URL` | none (degraded) | retries 0.5 s to 30 s; `/healthz` 503 |
| propagator | `NATS_URL` | `nats://localhost:4222` | retries with backoff, logs `degraded` |
| store | `NATS_URL` | `nats://localhost:4222`; must be `nats://host[:port]` | retries 0.5 s to 30 s, logs `"health":"degraded"` |
| ros2-publisher | none | does not connect yet | n/a |
| viz-web server | none | does not connect yet | n/a |
| control-web server | none | does not connect yet | n/a |

The propagator and the store connect with the client name equal to the
service name (`propagator`, `store`) and with unlimited reconnects. Credentials in a
`NATS_URL` are masked as `***` in the logs of propagator and store.

### 4.3 Designed, not yet implemented
`docs/design/contracts.md` (ready) plans the package `trajectory.v1`, these
subjects and four JetStream streams. This is the intent, not the behavior
of the code:

| Subject | Message | Stream |
|---|---|---|
| `launches.accepted` | `LaunchAccepted` | `LAUNCHES` |
| `trajectories.computed` | `TrajectoryComputed` | `TRAJECTORIES` |
| `trajectories.stored` | `TrajectoryStored` | `TRAJECTORIES` |
| `pipeline.errors` | `PipelineError` | `ERRORS` |
| `status.<service>` (every 5 s) | `ServiceStatus` | none (core NATS) |
| `config.<service>.set` | `ConfigSet` | `CONFIG` |
| `config.<service>.applied` | `ConfigApplied` | `CONFIG` |

Also planned: binary Protobuf encoding, `Nats-Msg-Id` set to `launch_id`,
`max_payload` 8 MB, consumers idempotent on `launch_id`, a KV bucket
`launch_window` for the rate limit. Update this section when `proto/README.md`
lists the subjects.

## 5. IF-3 and IF-4: PostgreSQL

Server: PostgreSQL 17 (`compose.yml`), port 5432 published on `127.0.0.1`.

### 5.1 store (writer)
- Variables: `DATABASE_URL` (required; `postgresql://host[:port]/database`,
  `postgres://` and `jdbc:postgresql://` also accepted; credentials in the URL
  are refused), `DATABASE_USER` (required), `DATABASE_PASSWORD` (required,
  never logged).
- A missing or invalid variable is logged as `invalid configuration` (naming
  the variable, never its value) and the process exits with code 2.
- At start-up store applies the Flyway migrations of
  `services/store/src/main/resources/db/migration/` and only then connects to NATS.
  If PostgreSQL is down it retries with backoff (0.5 s up to 30 s).
- Schema at this commit: `V1__baseline.sql`, an empty baseline (`SELECT 1`).
  Flyway creates its own `flyway_schema_history` table. There are no
  application tables yet.

### 5.2 viz-web server (reader)
Not implemented: the server has no database connection or setting yet. The
design (`docs/design/project.md`) plans a separate read-only database user for it.

### 5.3 Designed tables
Not in the code; from the design: `<prefix>launches` (id, received_at, the
request, the config snapshot, status, end_reason, flight_time_s, max_height_m,
range_m) and `<prefix>trajectory_samples` (launch_id, seq, t_s, x/y/z_m,
vx/vy/vz_mps, phase), primary key (launch_id, seq).

## 6. IF-5: viz-web server API

Contract: `services/viz-web/server/openapi.yaml` (version 0.0.0). Server:
`services/viz-web/server/`.

| Setting | Default | Meaning |
|---|---|---|
| `VIZ_WEB_SERVER_HOST` | `127.0.0.1` | listen address (compose and the image set `0.0.0.0`) |
| `VIZ_WEB_SERVER_PORT` | `3001` | listen port; invalid: the process exits with an error |
| `LOG_LEVEL` | `info` | log level; logs are JSON (pino) |

Routes:

| Route | Response |
|---|---|
| `GET /healthz` | 200 `{"status":"ok"}`, or 503 `{"status":"degraded"}` when a dependency check fails. No check is registered yet, so it always answers 200 |

`GET /healthz` is reachable from the host at `http://127.0.0.1:3001/healthz`
(compose host port `${VIZ_WEB_SERVER_PORT:-3001}`). Unknown routes get
Fastify's default 404 body (not described in this contract). The server does
not serve the UI files: the UI is run with Vite (`npm run dev -w services/viz-web`,
port 5173) and is not in the compose stack.

Planned (design, not in the contract): `GET /api/live` (SSE),
`GET /api/launches`, `GET /api/launches/{id}/trajectory`, and
`GET /api/accepted-launches` (`docs/design/viz-backend.md`).

## 7. IF-6: control-web server API

Contract: `services/control-web/server/openapi.yaml` (version 0.0.0). Server:
`services/control-web/server/`.

| Setting | Default | Meaning |
|---|---|---|
| `CONTROL_WEB_PORT` | `5174` | listen port; invalid: the process exits with an error |

The listen address is fixed to `0.0.0.0` (no host variable). Compose
publishes it on `127.0.0.1:${CONTROL_WEB_SERVER_PORT:-3002}`.

| Route | Response |
|---|---|
| `GET /healthz` | 200 `{"status":"ok"}`; liveness only |
| any other route or method | 404 `{"statusCode":404,"error":"Not Found","message":"Route GET /nope not found"}` |

As for viz-web, the server does not serve the UI; the UI dev server uses port
5174 too (`npm run dev -w services/control-web`), so do not run both on one host.

Planned (design): `GET /api/services`, `POST /api/services/{name}/start|stop`,
`GET|PUT /api/config/{service}`.

## 8. IF-7: ROS2

Service: `services/ros2-publisher/` (ROS2 Jazzy, node name `ros2_publisher`).

- Messages and topics: none. The folder `services/ros2-publisher/msg/` does
  not exist; the node publishes nothing.
- Network configuration, from the environment: `ROS_DOMAIN_ID` and
  `ROS_STATIC_PEERS`. An unset or empty value counts as unset.
- At start-up the node logs one line: `no ROS2 network configured`, or
  `ROS2 network configured: ROS_DOMAIN_ID=<v> ROS_STATIC_PEERS=<v>`. It stays up
  in both cases. The `degraded` status on NATS is not implemented.
- Compose leaves both variables unset.

## 9. IF-8: Kubernetes API

Not implemented. The control-web server has no Kubernetes client yet and
`deploy/k8s/` does not exist. Design: a ServiceAccount allowed to get, list and
watch deployments and pods and to update `deployments/scale` in its namespace.

## 10. IF-9: the npm package

`@albertoriorda95/trajectory-proto` (`libs/trajectory-proto/`) holds the
TypeScript code generated from `proto/`, for the two web servers. At this
commit it contains the generated code of `demo.v1` only (`src/gen/demo/v1/ping_pb.ts`).
Its version is 0.0.0. The design plans 0.1.0 with the `trajectory.v1` messages and the
subject constants, published to GitHub Packages by the user pushing a tag.

## 11. Ports and environment, all services

Compose (`compose.yml`) publishes every port on `127.0.0.1` only.

| Service | Container port | Host port (variable, default) | Protocol |
|---|---|---|---|
| nats | 4222 | `NATS_PORT`, 4222 | NATS |
| nats | 8222 | `NATS_MONITOR_PORT`, 8222 | HTTP monitoring, `/healthz` |
| postgres | 5432 | `POSTGRES_PORT`, 5432 | PostgreSQL |
| api | 8000 | `API_PORT`, 8000 | HTTP |
| viz-web server | 3001 | `VIZ_WEB_SERVER_PORT`, 3001 | HTTP |
| control-web server | 5174 | `CONTROL_WEB_SERVER_PORT`, 3002 | HTTP |
| viz-web UI (Vite dev) | 5173 | not in compose | HTTP |
| control-web UI (Vite dev) | 5174 | not in compose | HTTP |
| propagator, store, ros2-publisher | none | none | no inbound interface |

Environment variables set by compose for each service:

| Service | Variables |
|---|---|
| api | `NATS_URL=nats://nats:4222`, `API_HOST=0.0.0.0`, `API_PORT=8000` |
| propagator | `NATS_URL=nats://nats:4222` |
| ros2-publisher | none (`ROS_DOMAIN_ID`, `ROS_STATIC_PEERS` unset) |
| store | `NATS_URL=nats://nats:4222`, `DATABASE_URL=postgresql://postgres:5432/<POSTGRES_DB>`, `DATABASE_USER`, `DATABASE_PASSWORD` (from `POSTGRES_USER`, `POSTGRES_PASSWORD`), `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=75` |
| viz-web | `VIZ_WEB_SERVER_HOST=0.0.0.0`, `VIZ_WEB_SERVER_PORT=3001` |
| control-web | `CONTROL_WEB_PORT=5174` |

Host-side values come from `.env` (copy `.env.example`); `POSTGRES_DB`,
`POSTGRES_USER` and `POSTGRES_PASSWORD` are required by compose.

Health checks in the images: api, viz-web and control-web call `GET /healthz`;
propagator, store and ros2-publisher only check that process 1 is alive
(`kill -0 1`), not their connections. Kubernetes manifests: none yet.

## 12. Versions

| Interface | Version | Rule |
|---|---|---|
| api REST | 0.1.0 | breaking changes (field, type, status code, error shape) need the user's approval; prefer expand-contract (`AGENTS.md` > API contract) |
| viz-web, control-web server APIs | 0.0.0 | same |
| Protobuf | package `demo.v1` (placeholder); `trajectory.v1` planned | `npx buf breaking --against '.git#branch=main'` in CI |
| npm package | 0.0.0 (`libs/trajectory-proto/package.json`) | published on a user-pushed tag |
