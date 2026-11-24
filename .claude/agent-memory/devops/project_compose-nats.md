---
name: compose-nats
description: NATS in compose reads deploy/nats/nats.conf; inline configs.content fails on read_only; nats-init creates streams; publish a hand-encoded protobuf set via nats-init (#33, #93)
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
- Smoke-testing a protobuf config set without generated code (#93): hand-encode
  the bytes and pipe them through the nats-init image:
  `docker compose run --rm --no-deps --entrypoint sh nats-init -c "printf '<octal-escaped bytes>' | nats pub config.<svc>.set --force-stdin"`.
  Then check the service log and its config file in the volume.

**Why:** found while doing #33. Each point cost one failed attempt.

**How to apply:** for the M6 Kubernetes NATS, reuse `deploy/nats/nats.conf`
(as a ConfigMap) and run the same stream loop as a Job or init step. See
[[ci-sandbox-limits]].
