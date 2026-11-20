The REST contract of `services/api` lives here: `openapi.yaml` (see AGENTS.md
→ API contract). backend owns it; the web apps generate their client types
from it with `openapi-typescript`. The NATS messages are in `proto/`, the
control panel's server API in `services/control-web/server/openapi.yaml`.
