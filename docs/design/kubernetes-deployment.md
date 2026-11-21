---
feature: kubernetes-deployment
ready: yes               # yes only when the checklist below is complete
updated: 2026-11-21
owner: designer
milestone: M6
features: kubernetes-deployment
---

# Kubernetes deployment (minikube)

## Goal
The operator brings the whole system up on minikube from the manifests in
`deploy/k8s/`: NATS with its JetStream streams, PostgreSQL, and every service,
reachable through the local ingress. Services that can scale run as two
replicas behind a Service that load-balances them. Every replica gets its
configuration from one source (the JetStream `CONFIG` stream) and every
credential from a Kubernetes Secret. The control-web server reaches the
Kubernetes API through a ServiceAccount that can do only what `project.md`
allows.

Success: a `POST /launches` sent through the ingress is propagated, stored and
visible in the viewer, with more than one replica of the services that scale,
and the system survives the loss of any single pod without losing or
duplicating a launch.

## Out of scope
- The verification document and the end-to-end verification run (roadmap
  feature `verification`, a team task).
- Production or cloud deployment, Helm charts, GitOps, TLS, network policies.
- Clustered NATS or highly available PostgreSQL: one instance each.
- Autoscaling (HPA): replica counts are fixed in the manifests.
- Applying anything to a cluster from CI or from an agent: devops writes and
  renders the manifests, a human applies them.
- The behavior of propagator, store, ros2-publisher and control-web beyond
  what this spec adds (start-up config, health listener, Start/Stop,
  credentials): the specs of M2, M4 and M5 own the rest.

## User flows
1. **Bring-up.** The operator starts minikube
   (`minikube start --cpus=4 --memory=6g --addons=ingress`), builds the images
   into minikube, runs `deploy/k8s/create-secrets.sh`, applies
   `deploy/k8s/overlays/minikube`, and adds three `/etc/hosts` lines for
   `trajectory.local`, `control.trajectory.local` and `api.trajectory.local`
   pointing at `minikube ip`. The `nats-init` Job applies the streams of
   `proto/nats/streams/` and the `db-init` Job creates the database roles;
   the services wait for both (init containers).
2. **Use.** The operator sends `POST /launches` to `api.trajectory.local`,
   opens `trajectory.local` to watch it, and opens `control.trajectory.local`
   to see the replicas of every service.
3. **Stop and start.** In the control page the operator stops a pipeline
   service: its Deployment is scaled to 0. Starting it scales the Deployment
   back to the baseline replica count of its manifest: 2 for api, viz-web,
   propagator and store, 1 for control-web and ros2-publisher. NATS and
   PostgreSQL are read-only in the control page. Both operations go through
   the ServiceAccount.
4. **Config.** A config change sent from the control page lands on the
   `CONFIG` stream; every replica applies it live and confirms with its own
   `config.<service>.applied`. A replica that restarts, or is added, reads the
   latest message at start-up; the local file is only a fallback. The
   `CONFIG` stream is on a PVC, so the configuration survives a NATS restart.
5. **Failure.** A pod removed with `kubectl delete pod` is replaced; the other
   replicas keep serving; no launch is lost or duplicated (idempotent on
   `launch_id`).
6. **Roll back.** `kubectl rollout undo deployment/<name> -n trajectory`
   returns one service to its previous version; `kubectl delete -k
   deploy/k8s/overlays/minikube` removes everything except the PVCs;
   `minikube delete` starts from nothing.

Edge and error cases:
- NATS or PostgreSQL not ready: the services retry with backoff and report
  `degraded` (foundations); the readiness probe fails, so the Service stops
  routing to them; the pods are not restarted, because no liveness or startup
  probe depends on a dependency.
- No config message on `CONFIG` yet: the service uses its defaults
  (launch-intake).
- A missing Secret: the pod stays in `CreateContainerConfigError`;
  `create-secrets.sh` is idempotent and re-runnable, and the bring-up order
  creates the Secrets before applying.
- `kubectl apply` run again sets every Deployment back to the replica count
  written in its manifest: a service stopped from the control page restarts,
  and a service that was scaled by hand returns to its baseline. This is
  documented in the bring-up steps (row 12).
- A new database table prefix (config) creates new tables at the next apply;
  the read-only user can read them because of default privileges.
- A credentials payload on `config.store.set` while the credentials are
  managed by the Secret: store refuses the whole message (`ok=false`, error
  "DB credentials are managed by a Kubernetes Secret") and applies nothing.
- The control-web ServiceAccount asked for anything else (Secrets, create,
  delete, another namespace): Kubernetes answers 403.

## Screens and states
No new screen. The control page already shows replicas ready/desired from the
kubectl adapter (M4). One change, in the Config form for store: the DB write
credentials field is disabled and shows the note "Managed by a Kubernetes
Secret. To change them, update the Secret and restart store." The other store
settings (for example the table prefix) stay editable and are still sent over
the `CONFIG` stream.

| Screen / component | States | Notes |
|---|---|---|
| control-web Config form, store, DB write credentials field | managed (disabled, with the note), editable (outside Kubernetes) | the other states of the form are the M4 ones |

Responsive behavior: unchanged. Accessibility: the disabled field keeps its
label and the note is linked to it with `aria-describedby`.
Tokens: only from the design system; none proposed.

## Data and API
Entities and fields: none.

Layout: `deploy/k8s/base/` (all objects) and `deploy/k8s/overlays/minikube/`
(ingress hosts, images `trajectory/<service>:dev` with `imagePullPolicy:
IfNotPresent`, storage sizes), rendered with `kubectl kustomize`.

| Object | For | Notes |
|---|---|---|
| Namespace `trajectory` | everything | the ServiceAccount's Role is scoped to it |
| ConfigMap `trajectory-env` | non-secret settings (`NATS_URL`, `DATABASE_URL`, ports, `HEALTH_PORT`, `CREDENTIALS_MANAGED=true`) | same names as `.env.example` |
| Secret `postgres-admin` | PostgreSQL superuser password | used by PostgreSQL and the `db-init` Job only |
| Secret `store-db` | store's write credentials (`DATABASE_USER`, `DATABASE_PASSWORD`) and `STORE_CONFIG_KEY` | the only source of the write credentials in Kubernetes |
| Secret `viz-web-db` | viz-web's read-only user | separate from store's |
| StatefulSet + Service `nats` | JetStream bus | 1 replica, `max_payload` 8 MB, JetStream on a 1 Gi PVC |
| StatefulSet + Service `postgres` | database | 1 replica, 2 Gi PVC |
| Job `nats-init` | creates the four streams of `proto/nats/streams/` | nats-box pinned by digest, idempotent |
| Job `db-init` | with the `postgres-admin` Secret, creates the store write role and the viz-web read-only role, and grants the read-only role SELECT on the schema's tables and, as a default privilege, on the tables created later | idempotent (safe to run twice), never logs a password |
| Deployment + Service per service | api, propagator, store, ros2-publisher, viz-web, control-web | see the table below |
| Ingress | `trajectory.local` (viz-web), `control.trajectory.local` (control-web), `api.trajectory.local` (api) | host-based, no app changes |
| ServiceAccount, Role, RoleBinding `control-web` | the kubectl adapter | get/list/watch `deployments` and `pods`; update `deployments/scale`; only in `trajectory`. Start reads the baseline annotation with `get` on deployments, which is already allowed: no extra verb |

Per service (replicas, resources as requests / limits, port of `/healthz`):
| Service | Replicas | CPU | Memory | Port | Notes |
|---|---|---|---|---|---|
| api | 2 | 100m / 250m | 128Mi / 256Mi | `API_PORT` (8000) | |
| propagator | 2 | 100m / 500m | 128Mi / 512Mi | `HEALTH_PORT` (8081) | shared durable consumer on `launches.accepted` |
| store | 2 | 200m / 500m | 384Mi / 768Mi | `HEALTH_PORT` (8081) | shared durable consumer on `trajectories.computed` |
| ros2-publisher | 1 | 100m / 500m | 128Mi / 512Mi | `HEALTH_PORT` (8081) | one replica: more would publish each trajectory twice |
| viz-web | 2 | 100m / 250m | 128Mi / 256Mi | `VIZ_WEB_PORT` (5173) | an ephemeral consumer per replica (viz-backend) |
| control-web | 1 | 50m / 250m | 64Mi / 128Mi | `CONTROL_WEB_PORT` (5174) | |
| nats | 1 | 100m / 500m | 128Mi / 512Mi | 4222, 8222 | |
| postgres | 1 | 200m / 1 | 256Mi / 1Gi | 5432 | |

Every container: `runAsNonRoot`, `readOnlyRootFilesystem` with an `emptyDir`
on `/tmp` where the runtime needs it (JVM, ROS2), `allowPrivilegeEscalation:
false`, all capabilities dropped, no exceptions. Images pinned by digest for
NATS, PostgreSQL and nats-box; the service images use the `:dev` tag built in
minikube.

Probes (the six services):
- Readiness: `httpGet /healthz` on the service's port. A `degraded` service
  answers 503 and receives no traffic.
- Liveness: a `tcpSocket` check on the same port. It does not call
  `/healthz`, so it never depends on NATS or PostgreSQL: a NATS outage cannot
  restart a pod.
- Startup: the same `tcpSocket` check, up to 120 s (JVM, ROS2). An HTTP
  startup probe on `/healthz` would restart pods that start while NATS is
  down.
- NATS: readiness `httpGet /healthz?js-enabled-only=true` on 8222, liveness
  `httpGet /healthz` on 8222. PostgreSQL: readiness and liveness `exec
  pg_isready`.

Health listener for propagator, store and ros2-publisher: in foundations only
api, viz-web and control-web have an HTTP `/healthz`. These three get a
minimal listener on `HEALTH_PORT` (default 8081, new environment variable)
with the same behavior: `GET /healthz` answers 200 `{"status":"ok"}`, or 503
`{"status":"degraded"}` while NATS or PostgreSQL is unreachable.

Replica baseline: the replica count of each Deployment is written in its
manifest, and the annotation `trajectory/baseline-replicas` on the same
Deployment is derived from that number by a Kustomize replacement, so the two
cannot differ. The control-web server's Start scales to the annotation, Stop
scales to 0 (this replaces "start = 1" of `project.md` flow 7 for the services
with a baseline above 1). `kubectl apply` sets the replicas back to the
manifest values.

Credentials: store reads its write credentials and `STORE_CONFIG_KEY` from the
`store-db` Secret environment. In Kubernetes `CREDENTIALS_MANAGED=true` (in
the ConfigMap): store refuses any credentials payload as described in the edge
cases, and the control-web server reports the field as managed. To change the
credentials: update the Secret and run `kubectl rollout restart
deployment/store -n trajectory`. The other store settings go through the
`CONFIG` stream as before.

Config at start-up: propagator, store and ros2-publisher read the latest
message of `config.<service>.set` from the `CONFIG` stream at start-up
(`project.md`); the local file is the fallback when the stream has none or NATS
is unreachable.

The `instance` of `ServiceStatus` and `ConfigApplied` (contracts) is the pod
name, which is the container's hostname in Kubernetes: no new variable.

New environment variables: `HEALTH_PORT` (propagator, store, ros2-publisher)
and `CREDENTIALS_MANAGED` (store, control-web), both added to `.env.example`
by the rows that use them.

### Requirements on the specs of M2, M4 and M5
Those specs are not written yet; each one must include what this spec needs
from it, and the rows of the breakdown below refer to their first row:
- propagation (M2) and ros2-publishing (M5): read the latest config message at
  start-up, with the local file as fallback; the `HEALTH_PORT` listener.
- persistence (M2): the same for store; credentials from the environment; the
  refusal of a credentials payload when `CREDENTIALS_MANAGED=true`.
- control-panel (M4): the DB write credentials field of the store form can be
  disabled with the note above; `GET /api/config/store` returns
  `credentials_managed` (boolean, additive, from `CREDENTIALS_MANAGED`); Start
  restores the baseline from the annotation and Stop scales to 0, instead of
  "start = 1".

Contract changes: none to `docs/api/` or `proto/`. `config.store.applied` uses
the existing `ok` and `error` fields. The control-web server API gains
`credentials_managed` (additive), applied by the control-panel spec.
Breaking for existing clients: no

## Acceptance criteria
- [ ] `kubectl kustomize deploy/k8s/overlays/minikube | kubeconform -strict` passes, with no cluster; in the rendered output the annotation `trajectory/baseline-replicas` of every Deployment equals its `spec.replicas`.
- [ ] On a fresh minikube, the bring-up of flow 1 ends with every Deployment and StatefulSet available and both Jobs complete.
- [ ] `kubectl get pods -n trajectory` shows 2 pods each for api, propagator, store and viz-web, and 1 each for control-web, ros2-publisher, nats and postgres.
- [ ] `nats stream info` in the cluster shows the four streams with the settings of contracts; after `kubectl delete pod nats-0` the streams and the latest `CONFIG` message are still there.
- [ ] A `POST /launches` to `api.trajectory.local` answers 202; the launch is visible in the viewer at `trajectory.local` within 2 s (`project.md`) and has one row in PostgreSQL.
- [ ] 50 requests to the api Service are answered by both pods (`instance` in the logs).
- [ ] A config change for propagator is confirmed by both replicas (two `config.propagator.applied`); a deleted propagator pod comes back with that config.
- [ ] Stop then Start of propagator in the control page ends with 2 replicas; Stop then Start of ros2-publisher ends with 1; after `kubectl apply` every Deployment shows its manifest replica count.
- [ ] `kubectl auth can-i` as `system:serviceaccount:trajectory:control-web`: yes for get/list/watch on deployments and pods and update on `deployments/scale`; no for create, delete, secrets, configmaps and any other namespace.
- [ ] `db-init` run twice succeeds both times; the viz-web user can SELECT (also on a table created after `db-init`) and cannot INSERT; the logs of the Job and of PostgreSQL contain no password.
- [ ] No Secret value appears in `deploy/k8s/`, in the rendered manifests or in any pod log.
- [ ] With NATS stopped, the pods of the six services become not ready and their restart count stays 0; after NATS returns they become ready with no manual step.
- [ ] `GET /healthz` on `HEALTH_PORT` answers 200 for propagator, store and ros2-publisher, and 503 `degraded` while NATS is down.
- [ ] Deleting any single pod during a launch leaves exactly one row per `launch_id`.
- [ ] A credentials change sent for store while `CREDENTIALS_MANAGED=true` is answered `ok=false` with "DB credentials are managed by a Kubernetes Secret" and changes nothing; the control page shows the field disabled with the note.

## Test seams
- Manifests: `kubectl kustomize deploy/k8s/overlays/minikube` and `kubeconform -strict` in CI, plus a check that each annotation equals its replica count: catches invalid YAML, wrong API versions, missing fields and a baseline that drifted; misses runtime behavior and RBAC semantics.
- RBAC: `deploy/k8s/check-rbac.sh` runs `kubectl auth can-i` as the control-web ServiceAccount for each verb, on minikube: catches over- and under-permission; needs a cluster.
- Jobs: `db-init` run twice against the PostgreSQL pod, then SELECT and INSERT as the read-only role, and a search of the Job and PostgreSQL logs for the password: catches idempotency, grants and leaks; misses a change of the store schema.
- Cluster smoke: the commands of the acceptance criteria run on minikube by the verification feature: catches wiring (ingress, Secrets, probes, load balancing, recovery); misses anything not exercised.
- Start-up config, health listener and credentials-managed behavior: through each service's own test seam, defined by its spec (propagator and store with a fake bus, ros2-publisher with its node test, control-web through its server inject): catches the fallback order, the 503 and the `ok=false` answer; misses the real cluster.

## Reuse
- Manifests: Kustomize (with its `replacements`), built into `kubectl`: no new tool.
- Validation: `kubeconform` (Apache-2.0), already named in `docs/roles/devops.md`.
- Streams: the `nats` CLI in `natsio/nats-box`, pinned by digest, as in contracts.
- `db-init`: the `psql` of the `postgres:17` image, already in the project.
- Images: the Dockerfiles of foundations#11, unchanged.
- NATS and PostgreSQL: the official images of compose, pinned by digest; no operator or chart.
- Nothing in `docs/general/libraries.md` applies (no team libraries); no new third-party dependency.

## Decisions
- 2026-11-20 — Replicas with load balancing, JetStream as the single config source (the local file is the fallback), the Secret as the source of the DB write credentials, a ServiceAccount limited to get/list/watch on deployments and pods and update on `deployments/scale`, DB credentials as Secrets — project.md (roadmap M6, flows 7 and 8, NFR "Secrets").
- 2026-11-20 — Local ingress `trajectory.local`, one namespace, minikube only — project.md.
- 2026-11-20 — Manifests live in `deploy/k8s/`, owned by devops, rendered and validated but never applied by an agent — AGENTS.md, docs/roles/devops.md.
- 2026-11-21 — Kustomize, a base and one `minikube` overlay — built into kubectl, matches the devops validation commands, no new tool.
- 2026-11-21 — Images built inside minikube, tagged `trajectory/<service>:dev`, `imagePullPolicy: IfNotPresent`, no registry — no credentials, works offline.
- 2026-11-21 — Host-based ingress (`trajectory.local`, `control.trajectory.local`, `api.trajectory.local`) — both web servers use `/api/*`, hosts need no app change.
- 2026-11-21 — 2 replicas for api, viz-web, propagator and store; 1 for control-web, ros2-publisher, nats and postgres — safe scaling without clustering; propagator and store share a durable consumer, idempotent on `launch_id`.
- 2026-11-21 — Secrets only referenced by name in manifests; `deploy/k8s/create-secrets.sh` creates them from `.env` or random values, never writes a value to a file or log, a human runs it — no secret in the repository, no extra tooling.
- 2026-11-21 — Start restores the baseline replica count of the manifest (annotation `trajectory/baseline-replicas`, derived from `spec.replicas`), Stop scales to 0, `kubectl apply` resets replicas to the manifest values (documented) — confirmed by the reviewer; keeps load balancing after a Stop and Start.
- 2026-11-21 — Readiness on `/healthz`; liveness and startup are `tcpSocket` checks on the same port, never calling a dependency — confirmed by the reviewer; a NATS or PostgreSQL outage must not restart pods (an HTTP startup probe on `/healthz` would).
- 2026-11-21 — propagator, store and ros2-publisher get a minimal `/healthz` listener on `HEALTH_PORT` (8081) — foundations gives an HTTP health endpoint only to api, viz-web and control-web, and readiness needs one.
- 2026-11-21 — PostgreSQL on a 2 Gi PVC and JetStream on a 1 Gi PVC, one instance each — confirmed by the reviewer; config and streams survive a restart.
- 2026-11-21 — A Job `db-init` with the `postgres-admin` Secret creates the roles: the viz-web read-only user with SELECT and default privileges, and the store write role; idempotent, never logs a password — confirmed by the reviewer for the read-only user; the store role is added because `store-db` needs a role to exist; a migration cannot hold a password.
- 2026-11-21 — In Kubernetes the DB write credentials come only from the Secret; the control page field is disabled with a note; other store settings still go over the `CONFIG` stream; the M4 spec must handle the disabled field — confirmed by the reviewer; one source, as project.md says.
- 2026-11-21 — Rows that change a service built in M2, M4 or M5 depend on `<feature>#1` of its spec (`propagation`, `persistence`, `ros2-publishing`, `control-panel`), and those specs list what they must include — the references are keys `create-issues` understands; the number is row 1, the first row of each of those specs, and moves with it if their breakdown changes.
- 2026-11-21 — Resource requests and limits, `securityContext` and probes as in the tables above — devops rules (non-root, read-only filesystem, limits); sized for `minikube start --cpus=4 --memory=6g`.
- 2026-11-21 — Rollback by `kubectl rollout undo` per service, `kubectl delete -k` for the whole system, `minikube delete` from nothing — devops rule: a deployment without rollback is not ready.

## Open questions
- (none)

## Task breakdown
Rows 7 to 11 change services whose specs (M2, M4, M5) are not written yet:
they depend on `<feature>#1` of those specs (`propagation`, `persistence`,
`ros2-publishing`, `control-panel`), which `create-issues` links once those
specs exist and shows as text until then.
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | devops | [repo] `deploy/k8s/` Kustomize base and `minikube` overlay: namespace, `trajectory-env` ConfigMap (with `HEALTH_PORT` and `CREDENTIALS_MANAGED`), NATS StatefulSet (8 MB `max_payload`, 1 Gi PVC) and PostgreSQL StatefulSet (2 Gi PVC) with Services and their probes, `nats-init` Job | foundations#11, contracts#2 | - |
| 2 | devops | [repo] `deploy/k8s/create-secrets.sh`: creates `postgres-admin`, `store-db` and `viz-web-db` from `.env` or random values, idempotent, never writes a value to a file or log | 1 | - |
| 3 | devops | [repo] Deployments and Services for api, propagator, store, ros2-publisher, viz-web, control-web: replicas, annotation `trajectory/baseline-replicas` derived from `spec.replicas` by a Kustomize replacement, readiness, liveness and startup probes, resources, `securityContext`, ConfigMap and Secret references, init containers waiting for `nats-init` and `db-init` | 1, 2, 5 | - |
| 4 | devops | [repo] Ingress with the three hosts | 3 | - |
| 5 | devops | [repo] Job `db-init`: with `postgres-admin`, creates the store write role and the viz-web read-only role with SELECT on the tables and default privileges; idempotent; never logs a password | 1, 2 | - |
| 6 | devops | [repo] ServiceAccount, Role, RoleBinding for control-web and `deploy/k8s/check-rbac.sh` | 1 | - |
| 7 | backend | [propagator] Read the latest `config.propagator.set` at start-up with the local file as fallback; `GET /healthz` on `HEALTH_PORT` | propagation#1 | - |
| 8 | backend | [store] Read the latest `config.store.set` at start-up with the local file as fallback; credentials from the environment; with `CREDENTIALS_MANAGED=true` refuse a credentials payload (`ok=false`); `GET /healthz` on `HEALTH_PORT` | persistence#1 | - |
| 9 | backend | [ros2-publisher] Read the latest `config.ros2-publisher.set` at start-up with the local file as fallback; `GET /healthz` on `HEALTH_PORT` | ros2-publishing#1 | - |
| 10 | backend | [control-web] Server: Start scales to the annotation `trajectory/baseline-replicas`, Stop to 0; `GET /api/config/store` returns `credentials_managed`; update `services/control-web/server/openapi.yaml` | 3, control-panel#1 | - |
| 11 | frontend | [control-web] Disable the store DB credentials field with the note "Managed by a Kubernetes Secret. To change them, update the Secret and restart store." when `credentials_managed` is true | 10, control-panel#1 | - |
| 12 | devops | [repo] `Makefile` targets for the documented commands (build the images in minikube, render, validate, secrets, up, rollback), including the note that `kubectl apply` resets replicas to the manifest values; `kubeconform` and the annotation check in `ci.yml`; bring-up and rollback steps in the MR | 3, 4, 5, 6 | - |

## Readiness checklist
- [x] goal, users and out of scope agreed
- [x] every flow has its error and edge cases
- [x] every screen has empty, loading, error and success states (one control field; the rest is M4)
- [x] contract changes written, breaking changes approved by the user (none)
- [x] acceptance criteria are observable
- [x] test seams agreed
- [x] reuse decided: team libraries and new dependencies named, or "none"
- [x] task breakdown with roles and dependencies
- [x] no open questions
