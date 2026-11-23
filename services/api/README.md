# services/api

Ingestion REST API (FastAPI, Python 3.12, uv). Contract: `docs/api/openapi.yaml`
(REST in), `proto/` (NATS out). Design: `docs/design/launch-intake.md`.

- Install: `uv sync`
- Run: `uv run trajectory-api`
- Test: `uv run pytest` (the integration tests need Docker: they start a NATS
  with testcontainers; without Docker run `uv run pytest -m "not integration"`)
- Lint: `uv run ruff check . && uv run ruff format --check .`; types: `uv run mypy .`

## Environment
| Variable | Default | Meaning |
|---|---|---|
| `NATS_URL` | none | NATS server; without it the api runs and stays `degraded` |
| `API_HOST` | `127.0.0.1` | bind address (`0.0.0.0` in a container) |
| `API_PORT` | `8000` | HTTP port |
| `LAUNCH_WINDOW_S` | `300` | the global launch window in seconds; for tests only |

## Behavior
- `POST /launches`: the body is validated first (422 problem with one entry per
  bad field). Then the global window is claimed with an atomic `create` of the
  key `last` in the KV bucket `launch_window` (TTL = the window, history 1;
  created at start-up if missing); if a launch holds it, 429 with
  `Retry-After` and `retry_after_s` (the seconds left, from the entry's server
  timestamp, rounded up). The config snapshot is the latest
  `config.propagator.applied` on `CONFIG` (`ok` with a propagator payload),
  otherwise the defaults (60 s, 0.01 s, version 0); gravity is 9.80665. The
  `trajectory.v1.LaunchAccepted` is published on `launches.accepted` with
  `Nats-Msg-Id` = launch_id and the stream ack is awaited: 202. Any NATS
  failure answers 503 and gives the window back.
- `GET /healthz`: 200 `ok` when connected to NATS, 503 `degraded` otherwise.
- `status.api`: a `trajectory.v1.ServiceStatus` every 5 s (`ok`, or
  `degraded` while the `launch_window` bucket is missing).
- Logs: JSON lines on stdout, one per request (`event: request`, outcome,
  status, launch_id, duration_ms).

## Generated code
`src/trajectory/v1/` is the Python code of `proto/trajectory/`, generated with
`services/api/buf.gen.yaml` and committed, so the api builds without buf or
network access. After changing `proto/trajectory/`, run
`services/api/scripts/generate-proto.sh` (needs `npm ci` at the root and access
to buf.build) and commit; `--check` fails when it is out of step. The
`protobuf` runtime in `pyproject.toml` stays on the plugin's 6.33.x.
