# Project: agent-team-demo-e2e

A physics-based trajectory prediction demo (vacuum, gravity only, no air
drag): a point mass launched by a directed force for a given duration, then
ballistic until it is back on the ground or the propagation time ends. A
`POST /launches` request goes through a pipeline of microservices over NATS
(validate, propagate, store, publish to ROS2) and is shown in a 3D web app; a
control web app shows the status and starts and stops the services. Everything
runs on Kubernetes (minikube). All text in English.

## Stack
Polyglot monorepo:
- `services/api`: Python 3.12, FastAPI, uv, pytest, ruff, mypy.
- `services/propagator`: C++20, CMake + Conan 2, GoogleTest, clang-format, clang-tidy.
- `services/ros2-publisher`: C++20, ROS2 Jazzy, colcon.
- `services/store`: Java 25, Gradle (wrapper), JUnit 5 + Testcontainers, Flyway, PostgreSQL.
- `services/viz-web`: Vue 3 + Vite + Three.js, TypeScript, Node 24.
- `services/control-web`: Vue 3 + Vite UI and a Node 24 server (status, kubectl start/stop, config).
- `proto/`: Protobuf schemas, buf (lint, breaking, generate for Python, C++, Java, TypeScript).
- `libs/trajectory-proto`: the npm package `@albertoriorda95/trajectory-proto`
  (TypeScript generated from `proto/`), published to GitHub Packages.
- Message bus NATS; database PostgreSQL; UI tests Playwright + axe.
- Local dev: Docker Compose (`compose.yml`); deployment: Kubernetes manifests
  in `deploy/k8s/` for minikube.
- The web apps and `libs/` are npm workspaces of the root `package.json`.

## Commands
Run them from the repository root unless a folder is given.
- Install: `npm ci` (web apps, proto lib); `uv sync` in `services/api`;
  `conan install . --build=missing` in `services/propagator`; `./gradlew`
  downloads the rest in `services/store`.
- Test:
  - api: `cd services/api && uv run pytest` (one file: `uv run pytest tests/test_x.py`)
  - propagator: `cd services/propagator && cmake --preset release && cmake --build --preset release && ctest --preset release`
  - ros2-publisher: `cd services/ros2-publisher && colcon build && colcon test && colcon test-result --verbose`
  - store: `cd services/store && ./gradlew test` (one class: `./gradlew test --tests '<Class>'`)
  - web apps, proto lib: `npm test --workspaces --if-present` (one app: `npm test -w services/viz-web`; one file: `npx vitest run <file>`)
  - UI: `npx playwright test`
- Lint: `npm run lint` (ESLint, web apps; one file: `npx eslint <file>`);
  `cd services/api && uv run ruff check . && uv run ruff format --check .`;
  `clang-format --dry-run --Werror` on the C++ sources; `npx buf lint` and
  `npx buf breaking --against '.git#branch=main'` on `proto/`.
- Type check: `npm run typecheck` (vue-tsc); `cd services/api && uv run mypy .`;
  clang-tidy through the CMake preset of `services/propagator`.
- Generate code from `proto/`: `npx buf generate`.
- Dev: `docker compose up` (NATS, PostgreSQL, the services); `npm run dev -w
  services/viz-web` (port 5173), `npm run dev -w services/control-web` (port
  5174); api on port 8000.

## How work is delegated in this project
Route by file boundary, not by topic:
<!-- agent-team:if role_frontend -->
- `services/viz-web/`, `services/control-web/` except `services/control-web/server/`, `packages/ui-tokens/`, `e2e/` → frontend
<!-- agent-team:end -->
<!-- agent-team:if role_backend -->
- `services/api/`, `services/propagator/`, `services/ros2-publisher/`, `services/store/` (with its migrations), `services/control-web/server/`, `proto/`, `libs/trajectory-proto/`, `docs/api/` → backend
<!-- agent-team:end -->
<!-- agent-team:if role_designer -->
- `docs/design/`, UI review → designer
<!-- agent-team:end -->
<!-- agent-team:if role_devops -->
- `.github/workflows/`, `ci/`, `services/*/Dockerfile`, `compose*.yml`, `deploy/`, root `package.json` scripts → devops
<!-- agent-team:end -->
<!-- agent-team:if role_optimizer -->
- Optimizing code that already works and is tested → optimizer
<!-- agent-team:end -->
<!-- agent-team:if role_writer -->
- `docs/software/`, the project `README.md` → writer (the software documentation; `docs/design/` stays the designer's)
<!-- agent-team:end -->

## Services
Each service has its folder and its contract; a task touches one service, and
its text starts with the service's name in brackets (`[api] ...`).
| Service | Folder | Language | Contract |
|---|---|---|---|
| api | `services/api/` | Python 3.12 | `docs/api/openapi.yaml` (REST in), `proto/` (NATS out) |
| propagator | `services/propagator/` | C++20 | `proto/` (NATS in and out) |
| ros2-publisher | `services/ros2-publisher/` | C++20, ROS2 Jazzy | `proto/` (NATS in), its ROS2 messages (`services/ros2-publisher/msg/`) |
| store | `services/store/` | Java 25 | `proto/` (NATS in), the database schema (`services/store/src/main/resources/db/migration/`) |
| viz-web | `services/viz-web/` | Vue 3, TypeScript | `proto/` through `libs/trajectory-proto`, `docs/api/openapi.yaml` |
| control-web | `services/control-web/` | Vue 3, Node 24 | its server API (`services/control-web/server/openapi.yaml`) |
| proto | `proto/`, `libs/trajectory-proto/` | Protobuf | the messages themselves |
A change of one service's contract that another service uses is an alignment
change ("Alignment changes"): the services that call it are the affected roles.


Two agents never edit the same file in the same round. If a task crosses
a boundary, split it into two tasks with an explicit dependency.

## Standard feature sequence
When you plan or lead a feature with several roles: read
`docs/agents/workflow.md` for the order of the roles. Involve only the
roles the task actually touches.

## Leading a session
Each role is an agent of the harness you use, pointing to its prompt in
`docs/roles/`:
<!-- agent-team:if harness_claude -->
- Claude Code: `.claude/agents/` (`@backend`, `@designer`...)
<!-- agent-team:end -->
<!-- agent-team:if harness_opencode -->
- OpenCode: `.opencode/agents/`
<!-- agent-team:end -->

When you lead (you are not one of the roles):
- Delegate by file boundary, as above, and only to the roles the task touches.
- After every delegation, check `docs/alignment/` for entries with
  `status: open` and handle them as in "Alignment changes": designer first,
  then the affected roles, then mark the entry resolved. Ask the user only
  when designer sets `decision-needed: yes`.
- Between tasks start a fresh session. Only when the session has grown long
  or changes phase (design to implementation, one task to the next), end your
  reply by suggesting that the user run `/handoff` (the handoff skill, in
  Codex) and then `/clear`. You cannot run it yourself and a short session
  does not need it: do not suggest it otherwise.

## On-demand roles
These roles are never part of the standard sequence. Delegate to them
only when the user asks explicitly.
<!-- agent-team:if role_optimizer -->
- optimizer: when the user asks for an optimization or a measurement shows
  a performance problem. Only with green tests.
<!-- agent-team:end -->
<!-- agent-team:if role_security -->
- security: when the user asks for a security assessment, typically once the
  application is complete or before a release. It reports findings; the
  owning roles fix them as separate tasks.
<!-- agent-team:end -->
<!-- agent-team:if role_writer -->
- writer: when the user asks for documentation of the application (design
  document, ICD, user manual, install guide, API guide), typically before a
  release. It writes only in `docs/software/` and the `README.md`; the
  reference from the code is generated by the CI (`ci/reference.sh`).
<!-- agent-team:end -->

## API contract
The contracts are:
- `docs/api/openapi.yaml`: the REST API of `services/api` (`POST /launches`,
  status and history reads).
- `proto/`: the Protobuf messages on NATS between the services, and the
  subjects they are published on (documented in `proto/README.md`).
- `services/control-web/server/openapi.yaml`: the API between the control UI
  and its server.

Rules:
- backend owns them and updates them before or together with the code.
- Types are generated, never hand-written: `npx buf generate` for Python,
  C++, Java and TypeScript from `proto/`; `openapi-typescript` for the web
  apps from the OpenAPI files. A mismatch becomes a build error.
- `npx buf breaking` runs in CI on every change to `proto/`.
- Removing or renaming a field, reusing a Protobuf field number, changing a
  type, a NATS subject, a status code or an error shape is a breaking change: it is always an alignment change and needs the
  user's approval in the MR.
- Prefer expand-contract to a breaking change. Expand: add the new field or
  endpoint next to the old one (not breaking). Migrate: move the callers, in
  their own tasks. Contract: remove the old form in a last task, once nothing
  uses it; only this step is breaking. `main` stays green at every step.

## Alignment changes
A change is an alignment change when another role relies on what you
changed: the API contract, the data model, a shared component or design
token, a route or user flow, an environment variable or port, the
deployment interface. When you make one, read and follow
`docs/agents/alignment.md` before opening the MR. Never adapt other
roles' code yourself.

<!-- agent-team:if team_tasks -->
## Team tasks
A team task (`agent:team`) is one issue across several roles done by one
agent alone, without delegating, with the responsibilities of every role it
touches: `docs/roles/team.md`. As the lead, delegate to `team` only when the
user asks for a team task.

<!-- agent-team:end -->
<!-- agent-team:if split -->
## Splitting issues
When you are asked to propose how to split an issue into task issues
(`agent:split`, `SPLIT_ISSUE`): read `docs/agents/splitting.md`.

<!-- agent-team:end -->
## Specs before code
Implementation tasks (not issues with the `request` label: see
`docs/agents/requests.md`) start from a spec in `docs/design/` marked `ready: yes`
(see `docs/design/_spec-template.md`). The project design is
`docs/design/project.md`.
- If the task has no spec, the spec is not ready, or it does not cover what
  you are asked to do: stop, write what is missing in the issue or in your
  final message, and do not invent the missing design.
- Large design work happens in a studio session with the user
  (`docs/roles/design-studio.md`), not in MR comments. MR comments are code
  review.

## Reuse before writing
Before writing something generic or adding a dependency: what the project
already has, then the team's libraries (`docs/general/libraries.md`), then a
trusted library; read `docs/agents/dependencies.md`. Never install a package
name from memory, and never change a team library from this repository.

## Branches and merge requests
One branch per task. Before opening or updating an MR: read
`docs/agents/merge-requests.md` (branch name, update from `main`,
description sections).

## CI
A red CI is part of your task: fix the cause, never weaken a check (no
edits to `ci/scanners.env`, skipped tests or ignore rules without the
user's approval in the MR). When a check fails, or when you touch tests,
UI screens, workflows or CI files: read `docs/agents/ci.md`.

## Rules for everyone
- Small commits, messages in English, imperative mood.
- Nobody pushes to `main`. Nobody merges. Nobody closes an issue.
- If a requirement is ambiguous, stop and ask; do not guess.
