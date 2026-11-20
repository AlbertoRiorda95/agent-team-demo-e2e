---
feature: viewer
ready: no
updated: 2026-11-20
owner: designer
milestone: M3
features: viewer
---

# Viewer: live and history 3D view

This spec is a draft. It only holds the design moved from viz-backend (the live
stream over SSE, decided on 2026-11-20 and moved here because nothing produces
trajectories in M1). The rest is not designed yet: see "Open questions". It
stays `ready: no` until a studio session settles them.

## Goal
The user sees the latest computed trajectory in the browser within 2 s of the
202, and later browses the history. Success for the live part: a client
connected to `GET /api/live` receives the latest trajectory at once and each
new one as it is computed, and knows when the server has lost NATS.
Everything else: to be designed (open questions).

## Out of scope
- The viz-web server skeleton and the record of accepted launch requests
  (viz-backend, M1).
- Producing trajectories (propagation, M2).

## User flows
Live stream (moved from viz-backend, to be confirmed in the studio session):
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

Edge cases of the live stream:
- No trajectory yet (fresh stream): only the `bus` event; the client waits.
- Server restart: at start-up it reads the last message of
  `trajectories.computed` from the stream, so "latest" survives the restart.
- A message that does not decode or has no launch_id: not pushed, logged,
  `PipelineError` on `pipeline.errors`.
- The same trajectory delivered twice: sent once (same launch_id as the
  latest: dropped).
- An idle connection: an SSE comment every 15 s keeps proxies from closing it.
- A slow client: its pending writes are capped; above the cap the server
  closes it and the browser reconnects.

History, play/pause/rewind and the 3D scene: not designed.

## Screens and states
Not designed. Known constraint from the design system: the live view has
empty, loading, error and "disconnected" states; its "live disconnected" state
comes from the EventSource error or from `bus: disconnected`.

## Data and API
Contract change, `services/viz-web/server/openapi.yaml` (backend), live stream:
- `GET /api/live`: 200 `text/event-stream`. Events:
  - `bus`: data `{"nats": "connected" | "disconnected"}`.
  - `trajectory`: `id` = launch_id; data = a `trajectory.v1.TrajectoryComputed`
    in proto3 JSON with the proto field names (snake_case) and enums as names.
    The schema is described by reference to the proto message, not
    duplicated: the UI decodes it with the library's `fromJson`.

Subscription: an ordered, ephemeral JetStream consumer on
`trajectories.computed` (`TRAJECTORIES_COMPUTED` of the library), deliver
policy "last" at start, then new messages; each replica has its own, so any
replica serves any client.

History endpoints (`GET /api/launches`, `GET /api/launches/{id}/trajectory`)
and the read-only DB user: not designed. The M1 route `GET /api/accepted-launches`
(viz-backend) does not collide with them.

Breaking for existing clients: no (new routes).

## Acceptance criteria
Live stream, moved from viz-backend (the rest is to be written):
- [ ] With one `TrajectoryComputed` on the stream, a new client of `/api/live` receives `bus` connected and then that trajectory, with `id` = its launch_id, within 1 s.
- [ ] A trajectory published while two clients are connected reaches both within 500 ms; its JSON decodes with the library's `fromJson` to the published message.
- [ ] Reconnecting with `Last-Event-ID` equal to the latest launch_id gets no trajectory event; with another id, gets the latest.
- [ ] A message that does not decode is not pushed and produces one `PipelineError` with service `viz-web`.
- [ ] Stopping NATS sends `bus` disconnected to the clients; restarting it sends `bus` connected without restarting the server.
- [ ] An idle connection receives a comment line every 15 s.

## Test seams
Live stream, moved from viz-backend:
- Server: `GET /api/live` through Fastify listening on a random port, with a fake bus behind the subscription port (Vitest): catches the SSE format, replay of the latest, Last-Event-ID, fan-out, keep-alive, the bus events; misses real NATS.
- Integration: the server against a real NATS (Testcontainers) with the streams of `proto/nats/streams/`: catches the consumer settings, restart recovery of the latest, decode errors; misses the browser.
- UI: not defined.

## Reuse
- SSE written on the raw Fastify reply (the format is a few lines, no plugin).
- NATS client: nats.js v3, as in viz-backend.
- The rest (3D, UI): not decided.

## Decisions
Moved from viz-backend (2026-11-20, to be confirmed when the viewer is designed):
- 2026-11-20 — SSE pushed by the viz-web server, "live" = the latest computed trajectory — project.md.
- 2026-11-20 — `trajectory` events in proto3 JSON with proto field names, decoded with the library's `fromJson` — readable with curl, about 0.9 MB at the defaults.
- 2026-11-20 — Latest trajectory replayed on connect, `id` = launch_id with Last-Event-ID, `bus` events, 15 s keep-alive, an ephemeral consumer per replica, a cap on slow clients — the Viewer needs "latest" at once and to know when live is stale.
- 2026-11-20 — Live stream moved from viz-backend (M1) to the viewer (M3) — user's request on PR #31: nothing produces trajectories in M1.

## Open questions
- The 3D scene and UI: layout, camera, readouts, the sample table, states.
- History: list, pagination, selection, the `GET /api/launches` and `GET /api/launches/{id}/trajectory` shapes.
- Playback controls: play, pause, rewind, speed, scrubber.
- The read-only database user: creation (who, which migration), its Secret, and how the viz-web server uses it.
- Live vs history toggle, and how the live view relates to the record of accepted launches of viz-backend.

## Task breakdown
Not defined until the open questions are settled.

| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|

## Readiness checklist
- [ ] goal, users and out of scope agreed
- [ ] every flow has its error and edge cases
- [ ] every screen has empty, loading, error and success states
- [ ] contract changes written, breaking changes approved by the user
- [ ] acceptance criteria are observable
- [ ] test seams agreed
- [ ] reuse decided: team libraries and new dependencies named, or "none"
- [ ] task breakdown with roles and dependencies
- [ ] no open questions
