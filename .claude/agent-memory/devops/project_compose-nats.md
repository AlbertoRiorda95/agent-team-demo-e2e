---
name: compose-nats
description: NATS in compose reads deploy/nats/nats.conf (no CLI flag for max_payload); inline compose `configs.content` fails on read_only services; nats-init is the one-shot stream creator (issue #33, 2026-11-23)
metadata:
  type: project
---

- nats-server 2.15 has no `--max_payload` flag: the setting is in
  `deploy/nats/nats.conf`, mounted with a compose `configs:` `file:` entry.
- Compose v5 rejects inline `configs: content:` on a `read_only: true` service
  ("`file` is the sole supported option"). Use a file.
- `nats-init` (`natsio/nats-box:*-nonroot`, uid 1000) skips existing streams.
  JetStream is on tmpfs, so if NATS restarts by itself the streams are gone
  until the next `docker compose up` runs nats-init again.

**Why:** found while doing #33. Each point cost one failed attempt.

**How to apply:** for the M6 Kubernetes NATS, reuse `deploy/nats/nats.conf`
(as a ConfigMap) and run the same stream loop as a Job or init step. See
[[ci-sandbox-limits]].
