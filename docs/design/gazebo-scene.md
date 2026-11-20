---
feature: gazebo-scene
ready: yes              # yes only when the checklist below is complete
updated: 2026-11-20
owner: designer
milestone: Later
features: gazebo-scene
---

# Gazebo scene

## Goal
The operator sees the path of each computed trajectory in Gazebo, fed only by
the ROS2 trajectory messages of ros2-publisher (M5). A new service,
`services/gazebo-scene/`, holds a ROS2 node that keeps one sample every N and
publishes the result as a path, and a Gazebo scene that shows that path on a
ground plane with axes.
It works when, with the compose profile `gazebo` up, a `POST /launches` makes
its path appear in Gazebo, replacing the previous one.

## Out of scope
- Changing the M5 ROS2 messages or topics: the node only listens to them.
- Physics simulation in Gazebo, a 3D model of the mass, a moving marker, a replay of the motion, per-phase colors.
- A custom UI: Gazebo's own GUI and controls are the interface.
- NATS, PostgreSQL, the control panel, status heartbeats: the service reads only ROS2 (it is not listed in the control panel).
- Deployment to minikube; Gazebo in CI.

## User flows
1. The operator starts the scene with `docker compose --profile gazebo up`
   (off by default); the Gazebo window opens on the host display with an
   empty world: ground plane and ENU axes at the origin.
2. A launch is computed; ros2-publisher publishes the trajectory on ROS2.
3. The filter node receives it, keeps samples 0, N, 2N... and always the last
   one, and publishes a `nav_msgs/Path` (frame `world`, ENU, z up) on
   `/gazebo_scene/path`.
4. The scene shows that path as a line in Gazebo; the next trajectory's path
   replaces it.
5. The operator looks around with Gazebo's own controls.
Configuration: N is the ROS2 parameter `keep_every_n` (integer >= 1, default
10), set in the launch file or by the environment variable
`GAZEBO_SCENE_KEEP_EVERY_N` in compose.
Edge cases:
- No ROS2 publisher or no trajectory yet: the world shows only ground and axes; the node logs "waiting for trajectories".
- One-sample trajectory (no lift-off): a path of one pose; the scene shows nothing new and logs it.
- Fewer samples than N: first and last only.
- `keep_every_n` < 1 or not an integer: the node refuses to start and logs the reason.
- A message that cannot be read: logged and dropped; the shown path stays.
- No display on the host: the container exits with a log naming `DISPLAY`.

## Screens and states
| Screen / component | States | Notes |
|---|---|---|
| Gazebo world | empty (ground plane and axes), path shown, error (logged: no display, bad parameter) | one line for the latest path, Gazebo's default marker material; no other models |

Responsive behavior and accessibility: not applicable (Gazebo's desktop GUI,
not a web page); the viz-web viewer stays the accessible view.
Tokens: none (no web UI).

## Data and API
Entities and fields: none new.
- In: the ROS2 trajectory messages and topic defined by the ros2-publishing
  spec (M5, `services/ros2-publisher/msg/`), unchanged.
- Out: `/gazebo_scene/path`, `nav_msgs/Path`, frame `world`, one pose per kept sample (position from `x/y/z_m`, identity orientation, stamp from `t_s`).
- Settings: ROS2 parameter `keep_every_n`; compose variables `GAZEBO_SCENE_KEEP_EVERY_N`, `DISPLAY`, `ROS_DOMAIN_ID` (the same as ros2-publisher's).
Contract changes: none to existing contracts. The service's own output topic is
documented in `services/gazebo-scene/README.md`.
Breaking for existing clients: no
New service: `services/gazebo-scene/` is a new row of `AGENTS.md` > Services and of the routing (backend owns the code, devops the Dockerfile).

## Acceptance criteria
- [ ] With `keep_every_n = 10` and a 101-sample trajectory, the path has the poses of samples 0, 10, ..., 100; with 105 samples it ends with sample 104.
- [ ] `keep_every_n = 1` keeps every sample; 0 or a non-integer stops the node with a logged reason.
- [ ] The incoming messages are not modified and no M5 topic is published.
- [ ] `docker compose up` without the profile does not start gazebo-scene; `docker compose --profile gazebo up` starts it next to ros2-publisher.
- [ ] With the profile up, a `POST /launches` shows its path in Gazebo, and a second launch replaces it (checked by hand, in the verification chapter).
- [ ] CI runs the filter node's unit tests in a container, without Gazebo.
- [ ] The verification document has a Gazebo chapter: install, configuration, start, and the check above.

## Test seams
- Node: the filter function (trajectory, N) → poses and the node's parameter handling, with gtest in the service's container: catches the selection, the last-sample rule, the edge cases and the bad parameter; misses Gazebo and the display.
- Scene: by hand, following the verification chapter: catches the display and the replace; not automated (no Gazebo in CI, by decision).

## Reuse
- ROS2 Jazzy `rclcpp`, `nav_msgs` (Apache-2.0), ament_cmake, ament_cmake_gtest: as ros2-publisher.
- Gazebo Harmonic (the version paired with Jazzy) for the scene, with `ros_gz_bridge` / `ros_gz_sim` (Apache-2.0), only in the container image.
- The M5 trajectory message types: the generated ones of `services/ros2-publisher/msg/`, never hand-written.
- Depends on the ros2-publishing feature (M5), not designed yet: no ros2-publishing spec rows exist; the tracker has the issue #20 "Design: ros2-publishing". The verification chapter depends on the verification feature (M6, issue #22 "Design: verification"), which defines the document. These are linked as "blocked by" in the tracker.

## Decisions
- 2026-11-20 — The scene shows only a decimated path (every N, last kept) on ground and axes; no sphere, colors, replay or physics — the user scoped it to the path.
- 2026-11-20 — A new service `services/gazebo-scene/` (node and scene): backend owns the code, devops the Dockerfile — keeps Gazebo out of ros2-publisher.
- 2026-11-20 — Compose profile `gazebo`, off by default, not in minikube; no Gazebo in CI, only the filter node's unit tests in a container — Gazebo needs a display.
- 2026-11-20 — Gazebo chapter of the verification document as a team task, not a writer task — as the verification feature (M6).
- 2026-11-20 — Devops task for the Dockerfile, compose profile, CI job and the `AGENTS.md` service row; the team task holds only the verification chapter — no role owns `AGENTS.md`, devops owns the files around it; the 3-task limit is for dispatch, not the breakdown.
- 2026-11-20 — Spec ready before the ros2-publishing spec; dependencies are the issues #20 and #22 — the user wants ready specs and issues now, with only the dependencies that exist.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | backend | [gazebo-scene] ROS2 Jazzy package in `services/gazebo-scene/`: filter node (M5 trajectory in, every N plus the last as `nav_msgs/Path` on `/gazebo_scene/path`, parameter `keep_every_n`), Gazebo world (ground plane, axes) and launch file showing the path, gtest unit tests, README with the topic and parameter | the ROS publishing feature (its Design issue, see Reuse) | - |
| 2 | devops | [gazebo-scene] Dockerfile (pinned base with Jazzy and Gazebo Harmonic, non-root), compose profile `gazebo` (off by default, display and ROS_DOMAIN_ID), CI job running the unit tests in the container, the service row in `AGENTS.md` > Services and its routing | 1 | - |
| 3 | team | [gazebo-scene] Gazebo chapter of the verification document: install, configuration, starting the scene, and the check of a launch's path | 1, 2; the verification feature (its Design issue, see Reuse) | - |

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
