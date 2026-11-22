---
name: ci-runner-env
description: What the unattended CI runner for agent tasks has (network, tools) and quirks of npm/buf there
metadata:
  type: project
---

The agent CI runner (seen 2026-11-20, issue #3) has network to buf.build, registry.npmjs.org and GitHub; no `protoc` installed; Node 24; no `uv` (`pipx install uv` works, uv then downloads CPython 3.12 itself); Docker is available (`docker run nats:2-alpine` works for a real-NATS check).
`npm ci` warns that `@bufbuild/buf`'s postinstall is skipped (install-scripts policy) but `npx buf` still works (platform binary is an optional dependency).

**Why:** decides whether generation can use buf remote plugins and whether local tools must come from npm.
**How to apply:** prefer npm-provided plugins (protoc-gen-es) for steps that CI jobs without network-sensitive setup run; remote plugins are fine for `npx buf generate` at the root. See [[proto-toolchain]] in proto/README.md for the pinned protobuf version.
