---
feature: viewer
ready: yes
updated: 2026-11-28
owner: designer
milestone: M3
features: viewer
---

# Viewer: live and history 3D view

## Goal
The operator watches the latest computed trajectory in 3D in the browser
within 2 s of the 202, plays it back (play, pause, rewind, scrub), and browses
the stored history and opens any past trajectory the same way. The 3D view has
a text alternative (readout and sample table).
It works when: a `POST /launches` shows its trajectory in the Live view within
2 s without a reload; the History view lists the stored launches newest first
and opens any of them; the page passes axe at 768 and 1280 px and every
control works from the keyboard.

## Out of scope
- Linear interpolation between samples and the speed control (0.25×, 1×, 4×):
  playback-interpolation (Later, ready spec).
- A launch form (`project.md`): launches come only from `POST /launches`.
- Showing accepted launches that are not computed yet, or failed ones: store
  only records computed trajectories; `GET /api/accepted-launches` (M1) stays
  for the tests and is not used by the UI.
- History of table prefixes other than the one in force (old tables are kept
  by store but not listed).
- Deleting or editing history; search and filters in the list.
- Kubernetes manifests and the Secret of the read-only user (M6).
- Layouts below 768 px (`project.md`): at 320 px the page only has to stack
  without horizontal scroll, since the Playwright config runs every test there.

## User flows
1. **Open.** The operator opens the viewer: the Live view is selected; the
   page connects to `GET /api/live`.
2. **Live.** The latest trajectory (if any) is shown at once, paused at t = 0.
   A new trajectory replaces it, paused at t = 0 (same rule as
   playback-interpolation), and a visible, accessible notification says so:
   a toast "New trajectory <first 8 characters of launch_id> at <hh:mm:ss>:
   playback reset to 0", also sent to a polite live region. The trajectory
   shown on connect (the replay of the latest) is not announced.
3. **Playback.** Play advances t at 1× (requestAnimationFrame); the marker,
   the trail and the readout show the last sample at or before t; the sample
   table highlights it. Pause stops t. Rewind sets t = 0. The scrubber sets t;
   keyboard: arrows step one sample, Home/End go to the start/end. At the end
   playback stops at t_last; Play from the end restarts at 0.
4. **History.** The operator switches to History: the list loads the 50
   newest stored launches; "Load more" fetches the next page. Selecting a row
   loads its trajectory into the same scene, timeline, readout and table,
   paused at 0. Switching back to Live shows the latest live trajectory.
5. **Live while in History.** A new live trajectory does not change the view;
   the Live toggle shows "new" until the operator switches back, and the
   notification says "New live trajectory available" instead.

Live stream (designed in viz-backend on 2026-11-20, moved here):
1. **Connect.** The browser opens `GET /api/live`. The server answers
   `text/event-stream`, sends `event: bus` with the NATS state, then the
   latest trajectory if it has one (`event: trajectory`, `id: <launch_id>`).
2. **New trajectory.** A `TrajectoryComputed` arrives on NATS: the server
   keeps it as the latest and sends it to every connected client.
3. **Reconnect.** The browser reconnects with `Last-Event-ID`: if it equals
   the latest launch_id, the trajectory is not sent again.
4. **Bus lost and back.** The NATS connection drops: every client gets `event:
   bus` `{"nats":"disconnected"}`, the latest trajectory stays in memory;
   on reconnect `{"nats":"connected"}` and any trajectory computed meanwhile.

Edge cases:
- No trajectory yet (fresh stream): only the `bus` event; the Live view shows its empty state.
- One sample only (no lift-off): the scene shows the marker at the start, Play is disabled, the readout shows sample #0.
- `end_reason = time_limit`: shown in the summary ("Propagation time reached, not landed").
- 100000 samples (the contract's cap, about 15 MB of JSON): the polyline draws them all; the sample table is paged.
- Server restart: at start-up it reads the last message of `trajectories.computed`, so "latest" survives the restart.
- A message that does not decode or has no launch_id: not pushed, logged, `PipelineError` on `pipeline.errors`.
- The same trajectory delivered twice: sent once (same launch_id as the latest: dropped).
- An idle connection: an SSE comment every 15 s keeps proxies from closing it.
- A slow client: its pending writes are capped; above the cap the server closes it and the browser reconnects.
- EventSource error or `bus: disconnected`: the Live view shows "Live disconnected" over the current trajectory, which stays playable; it clears on `bus: connected`.
- PostgreSQL down: the History list shows its error state with Retry; the Live view is not affected.
- History trajectory 404 (unknown id): error state in the scene area with "Back to the list".
- No stored launch: the History list shows its empty state.
- The table prefix changes (a new `config.store.applied`): the next history request reads the new tables; the list the operator sees is not reloaded on its own.

## Screens and states
One page, `/`.

| Screen / component | States | Notes |
|---|---|---|
| Notification (toast) | hidden, shown | design-system toast, top right, for 8 s or until dismissed (close button "Dismiss"); never takes the focus; text mirrored in a polite `aria-live` region; a newer trajectory replaces the toast |
| Header | — | h1 "Trajectory viewer"; Live/History toggle (design-system toggle, "new" marker on Live); live status badge (ok "Live", warning "Live disconnected") |
| 3D scene | empty ("Waiting for the first trajectory" / "Select a launch"), loading, error, live disconnected (badge, scene kept), success | Three.js: ground grid sized to the trajectory, ENU axes with labels E, N, Up, polyline with burn segment `--color-burn` and ballistic `--color-accent`, mass marker, trail up to the current sample; perspective camera with orbit controls, fitted to the trajectory on load; "Reset view" button. `role="img"` with an `aria-label` summary; the readout and table are the alternative |
| Readout | empty (dashes), success | t, position x/y/z, velocity vx/vy/vz and speed, height, phase, "sample #n of N"; `--font-mono`, units always |
| Summary | empty, success | launch id (short), received/computed time, mass, position, azimuth, elevation, force, burn duration, end reason, flight time, range, max height |
| Timeline | disabled while empty or loading; success | Rewind, Play/Pause, scrubber (t in [0, t_last], `aria-valuetext` "t = 3.20 s"), t / t_last; burn range of the scrubber in `--color-burn` |
| Sample table | empty, success | columns seq, t, x, y, z, vx, vy, vz, phase; 100 rows per page with previous/next and "Go to current"; the current sample's row highlighted (`aria-current`); while paused the page follows the current sample |
| History list | loading (skeleton rows), empty ("No stored launches yet"), error (message + Retry), success | table: received at, mass, force, elevation, azimuth, burn, flight time, range, max height, end reason; newest first; rows selectable by click and Enter; selected row `aria-selected`; "Load more" while there is a next page |

Responsive behavior: at 1280 px the scene takes the left
two thirds, with the timeline under it; the right column holds the readout,
the summary and, in History, the list; the sample table spans the width
below. At 768 px one column: scene, timeline, readout, summary, list, table.
At 320 px the same column, tables scroll inside their own container.
Accessibility: WCAG 2.2 AA; every control reachable and operable from the
keyboard with a visible focus and an accessible name ("Play", "Pause",
"Rewind", "Playback time", "Reset view", "Live", "History", "Load more"); 44 px
targets; new live trajectory and loading/errors announced through a polite
live region; color never alone (phase also in text in the table and the
readout; status badge with a label); the orbit controls are optional, the
default camera shows the whole trajectory.
Tokens: only from the design system; new tokens proposed here: none.

## Data and API
Entities and fields: no new entity. The UI uses `TrajectoryComputed` and
`Sample` of `@albertoriorda95/trajectory-proto` in both views; history rows
come from the store tables `<prefix>launches` and `<prefix>trajectory_samples`
(V2), read only.

Contract changes, `services/viz-web/server/openapi.yaml` (backend):

Live stream (moved from viz-backend):
- `GET /api/live`: 200 `text/event-stream`. Events:
  - `bus`: data `{"nats": "connected" | "disconnected"}`.
  - `trajectory`: `id` = launch_id; data = a `trajectory.v1.TrajectoryComputed`
    in proto3 JSON with the proto field names (snake_case) and enums as names.
    The schema is described by reference to the proto message, not
    duplicated: the UI decodes it with the library's `fromJson`.

History:
- `GET /api/launches?limit=<1..200, default 50>&cursor=<opaque>`: 200
  `{ items: LaunchSummary[], next_cursor: string | null }`, newest first by
  (`received_at`, `id`), keyset pagination. `LaunchSummary`: `launch_id`,
  `received_at`, `computed_at` (RFC 3339 UTC), `request` (proto3 JSON
  `LaunchRequest`), `end_reason` (`END_REASON_GROUND` | `END_REASON_TIME_LIMIT`),
  `flight_time_s`, `max_height_m`, `range_m`, `sample_count`. 400 for a bad
  limit or cursor; 503 when PostgreSQL is unreachable.
- `GET /api/launches/{id}/trajectory`: 200 a `TrajectoryComputed` in proto3
  JSON, the same shape as the live event (`accepted_at` = `received_at`,
  `config` from the stored snapshot); 400 when `id` is not a UUID; 404 when
  unknown; 503 when PostgreSQL is unreachable.
- Errors as `application/problem+json` (`type`, `title`, `status`, `detail`),
  as in `docs/api/openapi.yaml`.

Subscriptions: an ordered, ephemeral JetStream consumer on
`trajectories.computed` (`TRAJECTORIES_COMPUTED` of the library), deliver
policy "last" at start, then new messages; each replica has its own. The
table prefix: an ordered consumer on `config.store.applied` (stream `CONFIG`,
the latest message per subject), deliver "last per subject": the prefix is
the `store` payload's `table_prefix` (the config in force, also when `ok` is
false); empty until a message arrives (store's default) — persistence.md.

Read-only database user:
- A NOLOGIN role `trajectory_reader` with `SELECT` on
  `<prefix>launches` and `<prefix>trajectory_samples`: store migration V3
  (`${prefix}`, so every prefix grants it), creating the role if it does not
  exist.
- A login user `viz_web`, member of `trajectory_reader`, created by a
  one-shot idempotent `db-init` service in compose, password from `.env`
  (`VIZ_WEB_DB_PASSWORD`); a Kubernetes Secret in M6.
- The viz-web server reads `DATABASE_URL`, `DATABASE_USER`,
  `DATABASE_PASSWORD` (the same names as store, its own values), and gets
  `NATS_URL` in compose.

Serving: the viz-web server serves the built UI at `/` and
the API under `/api` (one origin, no CORS); in dev Vite proxies `/api` to
port 3001. The image builds the UI and ships `dist/`.

Breaking for existing clients: no (new routes, a new migration that only
grants).

## Acceptance criteria
Live stream (moved from viz-backend):
- [ ] With one `TrajectoryComputed` on the stream, a new client of `/api/live` receives `bus` connected and then that trajectory, with `id` = its launch_id, within 1 s.
- [ ] A trajectory published while two clients are connected reaches both within 500 ms; its JSON decodes with the library's `fromJson` to the published message.
- [ ] Reconnecting with `Last-Event-ID` equal to the latest launch_id gets no trajectory event; with another id, gets the latest.
- [ ] A message that does not decode is not pushed and produces one `PipelineError` with service `viz-web`.
- [ ] Stopping NATS sends `bus` disconnected to the clients; restarting it sends `bus` connected without restarting the server.
- [ ] An idle connection receives a comment line every 15 s.

History:
- [ ] With 120 stored launches, `GET /api/launches` returns 50 newest first and a `next_cursor`; following the cursors returns all 120 once, the last page with `next_cursor: null`.
- [ ] `GET /api/launches/{id}/trajectory` returns the stored samples in seq order; its JSON decodes with `fromJson` and equals the `TrajectoryComputed` that store consumed (the timestamps to the microsecond).
- [ ] Unknown id: 404; bad id or cursor: 400; PostgreSQL stopped: 503; each `application/problem+json`.
- [ ] After a `config.store.applied` with prefix `demo_`, the history reads `demo_launches` without a restart.
- [ ] The `viz_web` user cannot INSERT, UPDATE or DELETE in either table (permission denied).

UI:
- [ ] A `POST /launches` in compose shows its trajectory in the Live view within 2 s, paused at t = 0, without a reload.
- [ ] The polyline shows the burn part in the burn color and the ballistic part in the accent color; the camera frames the whole trajectory on load and after "Reset view".
- [ ] Play advances t at 1× and stops at t_last; Pause holds t; Rewind sets 0; the scrubber and the arrow keys move one sample; the readout and the highlighted table row match the sample at or before t.
- [ ] A second live trajectory shows the toast "New trajectory <id> at <time>: playback reset to 0" and the same text in the polite live region, with the focus unchanged; the replay on connect shows no toast; in History the toast says "New live trajectory available" and the view does not change.
- [ ] A one-sample trajectory shows sample #0 with Play disabled.
- [ ] Live disconnected (SSE error or `bus` disconnected) shows the badge and keeps the trajectory playable; it clears on reconnect.
- [ ] History: the list loads, "Load more" appends the next page, selecting a row (click or Enter) opens it; empty, loading and error (with Retry) states are reachable.
- [ ] Every state passes axe at 768 and 1280 px, without horizontal scroll at 320, 768 and 1280 px, and every control works from the keyboard.

## Test seams
- Server: `GET /api/live`, `GET /api/launches`, `GET /api/launches/{id}/trajectory` through Fastify on a random port, with a fake bus and a fake history repository (Vitest): catches the SSE format, replay, Last-Event-ID, fan-out, keep-alive, bus events, pagination and cursors, the status codes and problem bodies; misses real NATS and SQL.
- Integration: the server against real NATS and PostgreSQL (Testcontainers), the streams of `proto/nats/streams/` and the store migrations applied with the `viz_web` user: catches the consumer settings, restart recovery of the latest, the prefix from `config.store.applied`, the SQL, the grants (read works, writes are denied); misses the browser.
- Store migration: `MigrationTest` with V3 on two prefixes: catches the role and the grants per prefix.
- UI modules (Vitest): the playback clock and the "sample at or before t" lookup, the SSE client state (connected, disconnected, new trajectory): catches the logic; misses the drawing.
- UI page: the Viewer with Playwright + axe at 320, 768 and 1280 px, `/api/live` and the history API mocked with `page.route()` (a small and a one-sample trajectory): catches the states, the keyboard, labels, layout, playback; misses WebGL pixel output and real data.

## Reuse
- Team library `@albertoriorda95/trajectory-proto` (0.2.0, the package of `libs/trajectory-proto/`, generated from `proto/`): the only source of the trajectory types and of the NATS subject names.
  - Server (tasks 2, 3): `TrajectoryComputed`, `ConfigApplied` and `PipelineError` with their `fromBinary`, `toJson` and `fromJson`; the subjects `TRAJECTORIES_COMPUTED`, `configAppliedSubject("store")`, `PIPELINE_ERRORS` and `statusSubject("viz-web")`; never a literal subject or a hand-written type. Task 3 builds the history `TrajectoryComputed` with the library's types, so it is the same shape as the live event.
  - UI (tasks 5, 6): `TrajectoryComputed`, `Sample` and their enums, with `fromJson`, to decode the live events and the history trajectory; the UI's workspace dependency on the package is added in task 5.
  - The M3 tasks only consume it, at the version above, and never change it. If something is missing, it is not added inside an M3 task: it becomes its own issue for the library (the `proto` service: `proto/` and `libs/trajectory-proto/`, owned by backend, with a new version of the package), and a dependency of the task that needs it. Nothing is missing today: the messages, `fromJson`/`toJson` and the subject helpers above all exist in 0.2.0.
- 3D: `three` (MIT), with `OrbitControls` from `three/examples/jsm`; no Vue wrapper library.
- PostgreSQL client in the server: `pg` (node-postgres, MIT).
- Serving the built UI: `@fastify/static` (MIT).
- UI types of the server API (the history list and the errors): `openapi-typescript` (AGENTS.md); the trajectory payloads are typed by the library above, not by the OpenAPI file.
- Integration tests: `@testcontainers/postgresql` next to the `testcontainers` already used.
- SSE: written on the raw Fastify reply (a few lines, no plugin); the browser's `EventSource` (no client library).
- NATS: nats.js v3, as in viz-backend.
- Playback clock, sample lookup, sample table paging: written here (small, pure functions).

## Decisions
- 2026-11-20 — SSE pushed by the viz-web server, "live" = the latest computed trajectory — project.md.
- 2026-11-20 — `trajectory` events in proto3 JSON with proto field names, decoded with the library's `fromJson` — readable with curl, about 0.9 MB at the defaults.
- 2026-11-20 — Latest trajectory replayed on connect, `id` = launch_id with Last-Event-ID, `bus` events, 15 s keep-alive, an ephemeral consumer per replica, a cap on slow clients — the Viewer needs "latest" at once and to know when live is stale.
- 2026-11-20 — Live stream moved from viz-backend (M1) to the viewer (M3) — user's request on PR #31: nothing produces trajectories in M1.
- 2026-11-24 — The table prefix comes from the latest `config.store.applied` — persistence.md.
- 2026-11-28 — M3 playback at 1× only: play, pause, rewind, scrubber, marker on the last sample at or before t; speed and interpolation stay in playback-interpolation (Later) — the ready Later spec owns them, no double work.
- 2026-11-28 — A new live trajectory replaces the current one paused at t = 0, with a visible toast mirrored in a polite live region (not on the replay at connect) — user's addition: a reset alone is not noticeable.
- 2026-11-28 — One page: scene and timeline left two thirds at 1280 px, readout/summary/list right, paged sample table below; one column at 768 px; 320 px only stacks; perspective camera with orbit controls, fit on load and Reset view — data first, the Playwright config tests 320 px.
- 2026-11-28 — History API: `GET /api/launches` with keyset cursor (default 50, max 200) and `GET /api/launches/{id}/trajectory` returning the same `TrajectoryComputed` JSON as the live event; problem+json errors; only the prefix in force; accepted-launches not used by the UI — one decoder in the UI, stable pages while launches arrive.
- 2026-11-28 — Read-only access: store migration V3 creates the NOLOGIN role `trajectory_reader` and grants SELECT per prefix; a compose `db-init` creates the login `viz_web` with `VIZ_WEB_DB_PASSWORD` (Secret in M6) — store never holds the reader's password.
- 2026-11-28 — `@albertoriorda95/trajectory-proto` 0.2.0 is the source of the trajectory types and subject names in the server and the UI; the M3 tasks consume it and never change it, anything missing is its own issue for the library — types are generated, never hand-written (AGENTS.md).
- 2026-11-28 — The viz-web server serves the built UI and `/api` from one origin, Vite proxies `/api` in dev; `three`, `pg`, `@fastify/static`, `openapi-typescript`, `@testcontainers/postgresql`, the browser's `EventSource` — no CORS, maintained MIT libraries.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | backend | [store] Migration V3 with `${prefix}`: NOLOGIN role `trajectory_reader` if missing, `SELECT` on `<prefix>launches` and `<prefix>trajectory_samples`; `MigrationTest` on two prefixes | — | - |
| 2 | backend | [viz-web] Server live stream, consuming `@albertoriorda95/trajectory-proto` 0.2.0 (types, `fromBinary`/`toJson`, subject names; not changed here): consumer on `trajectories.computed` (deliver last), `GET /api/live` SSE (replay, Last-Event-ID, bus events, keep-alive, slow-client cap), serving the built UI at `/` with `@fastify/static`, `server/openapi.yaml`, Vitest with a fake bus, integration on NATS | — | - |
| 3 | backend | [viz-web] Server history, consuming `@albertoriorda95/trajectory-proto` 0.2.0 (`ConfigApplied`, `TrajectoryComputed`, `configAppliedSubject`; not changed here): prefix from `config.store.applied`, `pg` with the read-only user, `GET /api/launches` (keyset pages) and `GET /api/launches/{id}/trajectory`, problem errors, `server/openapi.yaml`, Vitest with a fake repository, integration on NATS + PostgreSQL with the store migrations | 1, 2 | - |
| 4 | devops | [repo] compose: idempotent `db-init` service creating `viz_web` (member of `trajectory_reader`, password `VIZ_WEB_DB_PASSWORD` in `.env.example`); viz-web gets `NATS_URL` and `DATABASE_*` and depends on `nats-init` and `db-init`; the viz-web image builds the UI and ships `dist/` | 2 | - |
| 5 | frontend | [viz-web] Viewer page and Live view, consuming `@albertoriorda95/trajectory-proto` 0.2.0 as a workspace dependency (`TrajectoryComputed`, `Sample`, `fromJson`; not changed here): layout, Live/History toggle, Three.js scene (grid, axes, two-color polyline, marker, trail, fit and Reset view), readout, summary, timeline (play/pause/rewind/scrub at 1×), paged sample table, SSE client with the disconnected state and the new-trajectory toast with its live region, Vite `/api` proxy, types with `openapi-typescript`, Vitest and Playwright + axe with mocks | 2 | - |
| 6 | frontend | [viz-web] History view (trajectory decoded with the library's `fromJson`, as in 5): paged list with Load more, selection opens the trajectory in the scene, empty/loading/error states, Playwright + axe with mocks | 3, 5 | - |

## Readiness checklist
- [x] goal, users and out of scope agreed
- [x] every flow has its error and edge cases
- [x] every screen has empty, loading, error and success states
- [x] contract changes written, breaking changes approved by the user (none breaking)
- [x] acceptance criteria are observable
- [x] test seams agreed
- [x] reuse decided: team libraries and new dependencies named, or "none" (trajectory-proto 0.2.0, consumed only; three, pg, @fastify/static, openapi-typescript, @testcontainers/postgresql)
- [x] task breakdown with roles and dependencies
- [x] no open questions
