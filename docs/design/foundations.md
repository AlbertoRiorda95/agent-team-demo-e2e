---
feature: foundations
ready: yes
updated: 2026-11-20
owner: designer
milestone: M0
features: foundations
---

# Foundations — walking skeleton

## Goal
A skeleton that builds, starts and passes CI, with no product feature: every
service of `AGENTS.md` > Services exists in its folder with its toolchain,
starts, answers its health check, runs one smoke test with the commands of
`AGENTS.md` > Commands, and starts together with NATS and PostgreSQL in
`docker compose up`. After this, every feature task only adds behavior, never
scaffolding, and roles working in parallel do not collide on shared files.

## Out of scope
- Any business logic: validation rules, the rate limit, physics, the real
  Protobuf schemas (M1 contracts), persistence of launches, the 3D scene,
  status heartbeats, config handling.
- Kubernetes manifests (M6) and publishing `@albertoriorda95/trajectory-proto`
  (M1: here it is built, version 0.0.0, not released).

## User flows
1. A developer clones the repository, runs the install commands of
   `AGENTS.md` and `docker compose up --build`: NATS, PostgreSQL and every
   service start; each health check answers ok.
2. A developer runs the tests of one service with its command: one smoke test
   passes.
3. A pull request runs the CI: every job of `.github/workflows/ci.yml` runs
   (each service now exists) and `ci-ok` is green.
Error cases: a service that cannot reach NATS or PostgreSQL at start-up logs
a structured JSON error, keeps retrying with backoff, and its health check
answers `degraded` (503) instead of crashing.

## Screens and states
| Screen / component | States | Notes |
|---|---|---|
| viz-web placeholder page | success only | title "Trajectory viewer", the text "Skeleton: no trajectory yet", uses the tokens |
| control-web placeholder page | success only | title "Control panel", the text "Skeleton: no services yet", uses the tokens |

Responsive behavior: the placeholder pages have no horizontal scroll at 768
and 1280 px. Accessibility: one `h1`, `lang="en"`, no axe violations.
Tokens: `packages/ui-tokens/tokens.css` with the tokens of the design-system
skill (dark theme values), shared by both web apps.

## Data and API
Entities and fields: none (no product data).
- api serves the contract of `docs/api/openapi.yaml` with placeholder
  behavior: `GET /healthz` real (NATS connection); `POST /launches` validates
  the request shape and answers 422 as the contract says, else 202 with a new
  `launch_id`, without publishing anything and without rate limit.
- viz-web and control-web servers: `GET /healthz` only, their
  `server/openapi.yaml` with just that route.
- `proto/`: `buf.yaml`, `buf.gen.yaml` with Python, C++, Java and TypeScript
  targets, and one placeholder message `demo.v1.Ping` (the real schemas are
  M1 contracts).
- Database: store's Flyway set-up with an empty baseline migration
  `V1__baseline.sql`; configuration from the environment (`DATABASE_URL`,
  `DATABASE_USER`, `DATABASE_PASSWORD`, `NATS_URL`).
Contract changes: none (the contract file is served as it is).
Breaking for existing clients: no

## Acceptance criteria
- [ ] Each test command of `AGENTS.md` > Commands passes for every service, from a clean clone.
- [ ] `npm run lint`, `npm run typecheck`, `uv run ruff check .`, `uv run mypy .` and `npx buf lint` pass.
- [ ] `docker compose up --build` starts NATS (JetStream on), PostgreSQL and every service; `docker compose ps` shows all healthy.
- [ ] `curl -s localhost:8000/healthz` answers `{"status":"ok"}`; with NATS stopped it answers 503 `degraded` and the service keeps running.
- [ ] A contract test validates api's responses (202, 422, healthz) against `docs/api/openapi.yaml`.
- [ ] store applies `V1__baseline.sql` on an empty PostgreSQL (Testcontainers test).
- [ ] `npx buf generate` produces the code of `demo.v1.Ping` for the four languages, and `npm run build -w libs/trajectory-proto` builds the package.
- [ ] `npx playwright test` passes on both placeholder pages at 768 and 1280 px (and 320, as the config has it), with no axe violations.
- [ ] CI is green on the pull request with every service job running (none skipped for a missing manifest).

## Test seams
- api: `POST /launches` and `GET /healthz` through the FastAPI test client, responses checked against `docs/api/openapi.yaml`: catches contract drift; misses NATS behavior.
- propagator, ros2-publisher: the library's public header with GoogleTest (smoke), the node's start-up with colcon test: catches the toolchain; misses NATS.
- store: the Flyway migration on Testcontainers PostgreSQL: catches the DB set-up; misses NATS.
- web servers: `GET /healthz` through the Node test runner (Vitest + the server's inject/listen): catches the server wiring.
- web UIs: the placeholder page with Playwright + axe at the configured viewports: catches build, serving, tokens and accessibility.

## Reuse
- api: FastAPI (MIT), pydantic (MIT), nats-py (Apache-2.0), openapi-core (BSD-3) for the contract test.
- propagator: CMake + Conan 2, cnats (Apache-2.0, Conan `cnats`), GoogleTest (BSD-3).
- ros2-publisher: ROS2 Jazzy `rclcpp`, ament_cmake, ament_cmake_gtest.
- store: Gradle wrapper, Flyway (Apache-2.0), PostgreSQL JDBC (BSD-2), jnats (Apache-2.0), JUnit 5, Testcontainers (MIT).
- web servers: Fastify (MIT) on Node 24.
- web UIs: Vue 3, Vite, Vitest, ESLint (eslint-plugin-vue), vue-tsc, Playwright, @axe-core/playwright.
- proto: buf CLI from npm (`@bufbuild/buf`, Apache-2.0), protobuf-es for TypeScript (Apache-2.0).
- Images: `nats` 2.x with JetStream, `postgres` 17, pinned by digest in compose.

## Decisions
- 2026-11-20 — The root `package.json` (npm workspaces, shared scripts, buf) and `compose.yml` are devops's and come first — every other row builds on them, no two roles edit them.
- 2026-11-20 — One row per service: each service's skeleton is its own task — monorepo rule, parallel work.
- 2026-11-20 — Placeholder `demo.v1.Ping` instead of real schemas — M1 contracts owns the messages.
- 2026-11-23 — Services without an HTTP server (propagator, store, ros2-publisher) get a process-liveness container healthcheck only (`kill -0 1`), no probe endpoint and no extra port; "each health check answers ok" and the 503 `degraded` case apply to api, viz-web and control-web. Their degraded state is the `status.<service>` heartbeat of project.md (one status path) — no HTTP library or health file for three services, and no new port.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | devops | [repo] Root npm workspace (`package.json` with workspaces `services/viz-web`, `services/control-web`, `libs/trajectory-proto`, `packages/ui-tokens`; scripts `lint`, `typecheck`, `test`; ESLint and TypeScript base configs; `@bufbuild/buf`), `compose.yml` with NATS (JetStream) and PostgreSQL 17 with healthchecks, `.env.example`, `.nvmrc` pinning Node 24 | — | - |
| 2 | backend | [proto] `buf.yaml`, `buf.gen.yaml` (Python, C++, Java, TypeScript), the placeholder `demo.v1.Ping`, and the `libs/trajectory-proto` package (0.0.0, build from the generated TypeScript) | 1 | - |
| 3 | backend | [api] FastAPI skeleton with uv: `GET /healthz` (NATS), placeholder `POST /launches` per the contract, ruff and mypy config, contract test against `docs/api/openapi.yaml` | 2 | - |
| 4 | backend | [propagator] CMake + Conan 2 skeleton with `CMakePresets.json` (release), a library with a stub entry point, a NATS connection at start-up, a GoogleTest smoke test, `.clang-format` and `.clang-tidy` | 2 | - |
| 5 | backend | [ros2-publisher] colcon package (ament_cmake) whose node starts, logs "no ROS2 network configured" when none is set, and passes a gtest smoke test | 2 | - |
| 6 | backend | [store] Gradle (wrapper, Java 25 toolchain) skeleton with Flyway `V1__baseline.sql`, a NATS connection at start-up, a JUnit smoke test and a Testcontainers migration test | 2 | - |
| 7 | backend | [viz-web] Node 24 Fastify server in `services/viz-web/server/` with `GET /healthz`, its `openapi.yaml`, a Vitest test | 1 | - |
| 8 | backend | [control-web] Node 24 Fastify server in `services/control-web/server/` with `GET /healthz`, its `openapi.yaml`, a Vitest test | 1 | - |
| 9 | frontend | [viz-web] Vue 3 + Vite placeholder page, `packages/ui-tokens/tokens.css` from the design-system skill, Vitest smoke test; rename `playwright.config.ts.example` and `e2e/ui.spec.ts.example`, UI test of the page in `e2e/viz-web/`, `e2e/` excluded from Vitest | 1 | - |
| 10 | frontend | [control-web] Vue 3 + Vite placeholder page with the shared tokens, Vitest smoke test, UI test in `e2e/control-web/` | 9 | - |
| 11 | devops | [repo] A Dockerfile per service (pinned bases, non-root, healthcheck), every service in `compose.yml`, CI green with every service job running | 3, 4, 5, 6, 7, 8, 9, 10 | - |

## Readiness checklist
- [x] goal, users and out of scope agreed
- [x] every flow has its error and edge cases
- [x] every screen has empty, loading, error and success states (placeholders: success only, by design)
- [x] contract changes written, breaking changes approved by the user (none)
- [x] acceptance criteria are observable
- [x] test seams agreed
- [x] reuse decided: team libraries and new dependencies named, or "none"
- [x] task breakdown with roles and dependencies
- [x] no open questions
