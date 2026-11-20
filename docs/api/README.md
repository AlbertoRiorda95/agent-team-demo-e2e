The REST contract of `services/api` lives here: `openapi.yaml` (see AGENTS.md
→ API contract). backend owns it. The NATS messages are in `proto/`, the APIs
of the web app servers in `services/viz-web/server/openapi.yaml` and
`services/control-web/server/openapi.yaml`; the web UIs generate their client
types from those with `openapi-typescript`.
