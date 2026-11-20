---
feature: playback-interpolation
ready: yes              # yes only when the checklist below is complete
updated: 2026-11-20
owner: designer
milestone: Later
features: playback-interpolation
---

# Playback interpolation

## Goal
The operator plays, pauses, scrubs and changes the speed of a trajectory in the
viz-web Viewer, in both the live and the history view. The marker, the readout
and the trail show the state at any playback time t, linearly interpolated
between the two samples around t, so playback is continuous at any speed and
frame rate even with a coarse `sample_step_s` (up to 1 s).
It works when, at any t, the readout equals the linear interpolation of the two
surrounding samples, and at a sample's t it equals that sample.

## Out of scope
- Any physics in the browser: no recomputation of the trajectory, no Hermite or other higher-order scheme.
- Changing the propagator, the samples or any contract.
- Densifying the polyline: the path is drawn on the real samples only.
- Interpolation in other consumers (ROS2, Gazebo).
- Any animation library beyond Three.js.

## User flows
1. Play: the playback clock advances by frame time × speed (requestAnimationFrame);
   each frame draws the marker, the readout and the trail at the clock's t.
2. Pause: t stays where it is; the readout shows the interpolated values and
   "between #n and #n+1", or "sample #n" when t is exactly on a sample; the
   sample table highlights sample #n (the last sample at or before t).
3. Scrub: the scrubber sets t continuously in [0, t_last]. Keyboard: arrows
   step one sample, Shift+arrows step 1 s, Home/End go to the start/end.
4. Speed: a control with three values, 0.25×, 1× and 4× (default 1×), applied
   at once, also while playing.
5. Live and history: the same playback in both views. In the live view a new
   trajectory replaces the current one and playback restarts at t = 0, paused.
Edge cases:
- One sample only (no lift-off, `end_reason = ground`): t is fixed at 0, play does nothing, the readout shows sample #0.
- Past the end: t is clamped to t_last and playback stops (play from the end restarts at 0).
- Two samples with the same t (a regular sample on the burn-end instant): the later one is used, no division by zero.
- Live disconnected while playing: playback of the current trajectory continues; the viewer's disconnected state is shown.

## Screens and states
| Screen / component | States | Notes |
|---|---|---|
| Viewer: 3D marker and trail | empty, loading, error, live disconnected (the viewer's), success | marker at the interpolated point; trail = the samples up to #n plus the interpolated point |
| Viewer: readout | as above | t, position, velocity, height at t, in `--font-mono` with units; "between #n and #n+1" / "sample #n" |
| Viewer: timeline | as above; controls disabled while empty or loading | play/pause button, scrubber, speed control (0.25×, 1×, 4×) |
| Viewer: sample table | as above | highlights sample #n |
| Viewer: trajectory polyline | as above | the real samples, unchanged |

Responsive behavior: as the viewer; the timeline stays on one row at 1280 px and may wrap the speed control under the scrubber at 768 px.
Accessibility: every control (play/pause, scrubber, speed) is reachable and
operable from the keyboard and has an accessible label ("Play"/"Pause",
"Playback time", "Playback speed"); the scrubber has `aria-valuetext` with t in
seconds; the speed control is a radio group or select with the current value
announced; visible focus; 44 px targets; the readout stays the text alternative.
Tokens: only from the design system; new tokens proposed here: none.

## Data and API
Entities and fields: none new. Uses the Sample fields of the trajectory
(`t_s`, `x/y/z_m`, `vx/vy/vz_mps`, `phase`) through the generated
`@albertoriorda95/trajectory-proto` types, in both views.
Contract changes: none.
Breaking for existing clients: no

## Acceptance criteria
- [ ] At 20 random t of a known trajectory, the readout's position and velocity equal the linear interpolation of the samples around t (1e-12 relative).
- [ ] At the t of a sample, the readout shows exactly that sample's values and "sample #n".
- [ ] With `sample_step_s = 1`, playing at 1× moves the marker on every frame (no hold on one sample between frames).
- [ ] The speed control switches between 0.25×, 1× and 4×: 4 s of wall time advance t by 1 s, 4 s and 16 s.
- [ ] Past the end, playback clamps to t_last and stops.
- [ ] One-sample trajectories and duplicate sample times play without error.
- [ ] Playback works in the live view (a new trajectory restarts it at 0, paused) and in the history view.
- [ ] Play/pause, scrubber and speed are operable with the keyboard only, each has a label, and axe reports no violations.

## Test seams
- Module: the interpolation function (samples, t) → state, with Vitest on hand-made sample arrays: catches the math, clamping, one-sample and duplicate-t cases; misses the drawing.
- Module: the playback clock (frame times, speed) → t, with Vitest and fake timers: catches speed, clamp and stop; misses the rendering.
- UI: the Viewer page with Playwright + axe at 768 and 1280 px, history API and the live SSE mocked with a coarse trajectory: catches readout, scrubber keyboard steps, speed control, labels, live replace; misses the visual smoothness.

## Reuse
- Trajectory types: `@albertoriorda95/trajectory-proto` (generated), never hand-written.
- 3D drawing: Three.js, already the viewer's; no other animation library.
- Interpolation and playback clock: written here, two small pure TypeScript functions (linear interpolation needs no library).
- Depends on the viewer feature (M3), not designed yet: no viewer spec rows exist; the tracker has the issue #18 "Design: viewer". The task issue is linked to #18 as "blocked by" in the tracker.

## Decisions
- 2026-11-20 — Linear interpolation between samples, no physics in the browser — the brief asks for it; the propagator stays the only physics.
- 2026-11-20 — No polyline densification — with linear interpolation the real samples already are the drawn path.
- 2026-11-20 — Always on, no toggle; live and history views alike — one playback behavior.
- 2026-11-20 — Speed control 0.25×, 1×, 4× is part of this feature — the user asked for it with the interpolation.
- 2026-11-20 — In live view a new trajectory restarts playback at 0, paused — playback is user-controlled (`project.md`).
- 2026-11-20 — Spec ready before the viewer spec; the dependency is the issue #18 — the user wants ready specs and issues now, with only the dependencies that exist.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | frontend | [viz-web] Interpolated playback in the live and history views: linear interpolation module and playback clock with Vitest tests, marker/readout/trail/sample-table at any t, speed control (0.25x, 1x, 4x), keyboard and labels on every control, Playwright + axe test | the viewer feature (Design: viewer issue, see Reuse) | - |

## Readiness checklist
- [x] goal, users and out of scope agreed
- [x] every flow has its error and edge cases
- [x] every screen has empty, loading, error and success states
- [x] contract changes written, breaking changes approved by the user (none)
- [x] acceptance criteria are observable
- [x] test seams agreed
- [x] reuse decided: team libraries and new dependencies named, or "none"
- [x] task breakdown with roles and dependencies
- [x] no open questions
