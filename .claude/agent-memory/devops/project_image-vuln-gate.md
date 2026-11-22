---
name: image-vuln-gate
description: The CI image scan (trivy, HIGH/CRITICAL, unfixed included) fails on Debian-based bases; which bases pass and the tricks used (issue #12, 2026-11-22)
metadata:
  type: project
---

`ci/build-images.sh` (called by the `vulnerabilities` job) fails on any
HIGH/CRITICAL finding, **unfixed ones included** (`TRIVY_FAIL_SEVERITY`, no
`--ignore-unfixed`). Measured 2026-11-22 with trivy 0.76.0:
- Debian trixie bases (`debian:*-slim`, `python:3.12-slim`, `node:24-*-slim`,
  distroless debian13): 1-51 unfixed HIGH (util-linux, libssl). Fail.
- `ubuntu:24.04`, `eclipse-temurin:25-*-noble`, `node:24-alpine`: 0 OS findings.
- Node images: the bundled npm's own `brace-expansion`/`undici` fail; delete
  `/usr/local/lib/node_modules` and the npm/npx/corepack/yarn bins in the
  runtime stage.
- uv-managed CPython (`uv python install`): its bundled pip vendors urllib3 and
  msgpack; delete pip and ensurepip before copying `/opt/python`.
- `ros:jazzy-ros-core`: 92 findings all in `linux-libc-dev` (kernel headers);
  removed with `dpkg --remove --force-depends` (ROS packages hard-depend on it).

**Why:** weakening the gate or adding ignores needs the user's approval; base
choice is the fix that stays within devops's boundary.

**How to apply:** when adding or bumping an image, run trivy on it locally
before pushing; prefer ubuntu:24.04 / alpine bases. See [[buf-binary-grype]],
[[ci-sandbox-limits]].
