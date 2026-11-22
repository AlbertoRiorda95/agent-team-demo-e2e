---
name: ci-runner-env
description: What the unattended CI runner for agent tasks has (network, tools, docker) and quirks of npm/buf there
metadata:
  type: project
---

The agent CI runner (seen 2026-11-20, issue #3) has network to buf.build, registry.npmjs.org and GitHub; no `protoc` installed; Node 24; no `uv` (`pipx install uv` works, uv then downloads CPython 3.12 itself); Docker is available (`docker run nats:2-alpine` works for a real-NATS check).
`npm ci` warns that `@bufbuild/buf`'s postinstall is skipped (install-scripts policy) but `npx buf` still works (platform binary is an optional dependency).
No ROS2 on the runner, but Docker works (2026-11-22, issue #6): build and test ros2-publisher in `ros:jazzy` exactly as the CI job does (copy the package into the container, `rosdep install`, `colcon build/test`). `clang-format` and `cmake` are installed on the host.
Java: Temurin 25 (and 11/17/21) in `/usr/lib/jvm` plus a system Gradle 9.9; Maven Central and services.gradle.org reachable, so `./gradlew build` with Testcontainers (postgres, nats images) runs on the host (2026-11-22, issue #7).

**Why:** decides whether generation can use buf remote plugins, whether local tools must come from npm, and how to verify toolchains that are missing on the host.
**How to apply:** prefer npm-provided plugins (protoc-gen-es) for steps that CI jobs without network-sensitive setup run; remote plugins are fine for `npx buf generate` at the root. For missing toolchains (ROS2), try the CI job's container image with Docker. See [[proto-toolchain]] in proto/README.md for the pinned protobuf version.
