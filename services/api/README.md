# services/api

Ingestion REST API (FastAPI, Python 3.12, uv). Contract: `docs/api/openapi.yaml`.

- Install: `uv sync`
- Run: `uv run trajectory-api` (reads `NATS_URL`, `API_HOST` default `127.0.0.1`, `API_PORT` default `8000`)
- Test: `uv run pytest`; lint: `uv run ruff check . && uv run ruff format --check .`; types: `uv run mypy`

Foundations skeleton: `GET /healthz` reports the NATS connection (200 `ok` / 503
`degraded`); `POST /launches` validates the body and answers 202 with a new
`launch_id`, without publishing anything and without the rate limit yet.
