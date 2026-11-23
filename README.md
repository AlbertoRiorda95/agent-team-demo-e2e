# agent-team-demo-e2e

A physics-based trajectory prediction demo. A point mass of a given mass, at a
static position at or above the ground, gets an upward force (at an angle
between 0° and 90° above the horizon) for a given duration and then flies
ballistically in vacuum, under gravity only. The trajectory ends when the mass
is back on the ground, or at the propagation time if that comes first.

A launch request arrives with `POST /launches`. A pipeline of microservices
over NATS validates it, propagates the trajectory, stores it in PostgreSQL and
publishes it as ROS2 messages. A 3D web app shows the live and the historical
trajectories (play, pause, rewind), and a control web app shows the status of
the services and starts and stops them. After an accepted request, the next
requests are rejected with `429` for 5 minutes. Everything runs on Kubernetes
(minikube).

| Folder | What |
|---|---|
| `services/api/` | REST server (Python): validation, rate limit, NATS publish |
| `services/propagator/` | trajectory propagation (C++20) |
| `services/ros2-publisher/` | ROS2 Jazzy publisher (C++20) |
| `services/store/` | persistence to PostgreSQL (Java 25) |
| `services/viz-web/` | 3D visualization (Vue) |
| `services/control-web/` | control panel (Vue + Node) |
| `proto/`, `libs/trajectory-proto/` | Protobuf messages and their npm package |
| `deploy/k8s/` | Kubernetes manifests for minikube |

The project is built by an agent team: see `AGENTS.md`, the specs in
`docs/design/` and the software documentation in `docs/software/`.

Interfaces between the services and with the outside: `docs/software/icd.md`.
