---
feature: kubernetes-deployment
ready: no               # yes only when the checklist below is complete
updated: 2026-11-21
owner: designer
milestone: M6
features: kubernetes-deployment
---

# Kubernetes deployment (minikube)

> DRAFT after studio round 2. Round 1 is settled (see Decisions). Everything marked **[assumed]** comes from
> `project.md`, `AGENTS.md` and the specs of M0, M1 and M3 and still needs the
> user's confirmation. The specs of M2 (propagation, persistence), M4
> (control-panel) and M5 (ros2-publishing) do not exist yet: where this spec
> depends on them it says so.

## Goal
The operator brings the whole system up on minikube from the manifests in
`deploy/k8s/`: NATS with its JetStream streams, PostgreSQL, and every service,
reachable through the local ingress `trajectory.local`. Stateless services run
as several replicas behind a Service that load-balances them. Every replica
gets its configuration from one source (the JetStream `CONFIG` stream), and
all credentials come from Kubernetes Secrets. The control-web server reaches
the Kubernetes API through a ServiceAccount that can only do what
`project.md` allows. Success: a `POST /launches` sent through the ingress is
propagated, stored and visible in the viewer, with more than one replica of
the services that scale, and the same system survives the restart of any one
pod.

## Out of scope
- The verification document and the end-to-end verification run (roadmap
  feature `verification`, a team task).
- Any production deployment, cloud cluster, Helm chart publishing, GitOps.
- Clustered NATS or highly available PostgreSQL: one instance each.
- Autoscaling (HPA): replica counts are fixed in the manifests.
- TLS, authentication, network policies beyond what is listed below
  (**[assumed]**: a local demo, as in `project.md`).
- Applying anything to a cluster from CI or from an agent: devops writes and
  renders the manifests, a human applies them.

## User flows
1. **Bring-up.** **[assumed]** The operator starts minikube with the ingress
   addon, builds the images into minikube, creates the Secrets with the
   provided script, applies `deploy/k8s/` and waits for every Deployment to be
   available. The `nats-init` Job applies the streams of `proto/nats/streams/`
   before the services start.
2. **Use.** The operator opens `trajectory.local`, sends a launch with curl
   through the ingress and sees it in the viewer; the control-web page shows
   the replicas of every service.
3. **Scale.** The operator stops and starts a pipeline service in the control
   page: its Deployment is scaled to 0 and back to 1 through the
   ServiceAccount (`project.md`, flow 7).
4. **Config.** A config change sent from the control page lands on the
   `CONFIG` stream; every replica applies it live, and a replica that
   restarts or is added reads the latest message at start-up (`project.md`,
   flow 8).
5. **Failure.** A pod killed with `kubectl delete pod` is replaced; the
   others keep serving; no launch is lost or duplicated (consumers are
   idempotent on `launch_id`).

Edge and error cases:
- NATS or PostgreSQL not ready at start: the services retry with backoff and
  report `degraded` (foundations); their readiness probe fails until they
  recover, so the Service does not route to them. **[assumed]**
- No config message on `CONFIG` yet: the service uses its defaults
  (launch-intake).
- A missing Secret: the pod stays in `CreateContainerConfigError`; the
  bring-up script checks the Secrets exist before applying.
- `kubectl apply` run again resets the replica counts to the manifest values,
  including any value set by the control page (see Q6).

## Screens and states
None (no UI change). The control-web page already shows replicas
ready/desired from the kubectl adapter (M4).

## Data and API
Entities and fields: none.

Kubernetes objects, in `deploy/k8s/` (Kustomize base plus a `minikube` overlay):
| Object | For | Notes |
|---|---|---|
| Namespace `trajectory` | everything | the ServiceAccount's Role is scoped to it |
| ConfigMap `trajectory-env` | non-secret settings (`NATS_URL`, `DATABASE_URL`, ports) | same variable names as `.env.example` |
| Secret `postgres-admin` | the PostgreSQL superuser password | |
| Secret `store-db` | store's write credentials (`DATABASE_USER`, `DATABASE_PASSWORD`) and `STORE_CONFIG_KEY` | source of the write credentials from M6 (`project.md`) |
| Secret `viz-web-db` | viz-web's read-only user | separate from store's (`project.md`) |
| StatefulSet + Service `nats` | JetStream bus | one replica |
| StatefulSet + Service `postgres` | database, with a PVC | one replica |
| Job `nats-init` | creates the four streams from `proto/nats/streams/` | nats-box pinned by digest |
| Deployment + Service per service | api, propagator, ros2-publisher, store, viz-web, control-web | probes on `/healthz`, resource limits, non-root, read-only root filesystem, capabilities dropped (devops rules) |
| Ingress | `trajectory.local` (viewer), `control.trajectory.local` (control-web), `api.trajectory.local` (api) | host-based routing, no app changes; three `/etc/hosts` lines pointing at the minikube IP |
| ServiceAccount, Role, RoleBinding `control-web` | the kubectl adapter | get/list/watch `deployments` and `pods`; update `deployments/scale`; namespace `trajectory` only (`project.md`) |

Environment variables: the names of `.env.example` and of the M1 specs; no
new variable is expected, but replicas of one service make `instance` (the pod
name, from the downward API) mandatory in `ServiceStatus` and `ConfigApplied`
(contracts). **[assumed]**

Contract changes: none expected (`docs/api/`, `proto/` unchanged).
Breaking for existing clients: no

## Acceptance criteria
Draft, to be made final after the decisions are settled.
- [ ] `kubectl kustomize deploy/k8s | kubeconform -strict` passes (rendering and schema, no cluster needed).
- [ ] On a fresh minikube, the bring-up of flow 1 ends with every Deployment, StatefulSet and Job complete.
- [ ] `kubectl get pods -n trajectory` shows the replica counts of the Q4 decision.
- [ ] `nats stream info` inside the cluster shows the four streams with the settings of contracts.
- [ ] A `POST /launches` through the ingress answers 202; the launch appears in the viewer and in PostgreSQL within the 2 s of `project.md`.
- [ ] 50 requests to a Service with several replicas are answered by more than one pod (visible in the structured logs).
- [ ] A config change reaches every replica of the service (`config.<service>.applied` once per instance); a deleted pod comes back with the same config.
- [ ] `kubectl auth can-i` as the control-web ServiceAccount: yes for get/list/watch on deployments and pods and update on `deployments/scale`; no for anything else (create, delete, secrets, other namespaces).
- [ ] No Secret value appears in any file of `deploy/k8s/`, in `kubectl kustomize` output or in a pod log; the viz-web DB user cannot write.
- [ ] Deleting any single pod does not lose or duplicate a launch (one row in PostgreSQL per `launch_id`).

## Test seams
Draft.
- Manifests: `kubectl kustomize deploy/k8s` + `kubeconform -strict` in CI: catches invalid YAML, wrong API versions, missing fields; misses runtime behavior and RBAC semantics.
- Cluster: a smoke script run on minikube by the verification feature: catches wiring (ingress, Secrets, probes, load balancing); misses anything not exercised.
- RBAC: `kubectl auth can-i --as=system:serviceaccount:trajectory:control-web ...` for each verb: catches over- and under-permission; needs a cluster.

## Reuse
- Manifests: Kustomize, built into `kubectl` (`kubectl kustomize`): no new tool.
- Validation: `kubeconform` (Apache-2.0), already named in `docs/roles/devops.md`.
- Streams: the `nats` CLI in `natsio/nats-box`, pinned by digest, as in contracts (compose `nats-init`).
- Images: the Dockerfiles of foundations#11, unchanged.
- PostgreSQL and NATS: the official `postgres:17` and `nats:2` images of compose, pinned by digest; no operator, no Helm chart. **[assumed]**

## Decisions
- 2026-11-20 — Replicas with load balancing, JetStream as the single config source (replicas read the latest message at start-up, the local file is the fallback), the Secret as the source of the DB write credentials, a ServiceAccount limited to get/list/watch on deployments and pods and update on `deployments/scale`, DB credentials as Secrets — project.md (roadmap M6, flows 7 and 8, NFR "Secrets").
- 2026-11-20 — Local ingress `trajectory.local`, one namespace, minikube only — project.md.
- 2026-11-20 — Manifests live in `deploy/k8s/`, owned by devops, rendered and validated but never applied by an agent — AGENTS.md, docs/roles/devops.md.
- 2026-11-21 — Q1: Kustomize, a base and one `minikube` overlay — built into kubectl, matches the devops validation commands, no new tool.
- 2026-11-21 — Q2: images built inside minikube (`minikube image build` or `docker-env`), tagged `trajectory/<service>:dev`, `imagePullPolicy: IfNotPresent`, no registry — no credentials, works offline.
- 2026-11-21 — Q3: host-based ingress: `trajectory.local` is the viewer, `control.trajectory.local` control-web, `api.trajectory.local` api — both web servers use `/api/*`, hosts need no app change.
- 2026-11-21 — Q4: 2 replicas for api, viz-web, propagator and store (propagator and store share a durable JetStream consumer, idempotent on `launch_id`); 1 for control-web, ros2-publisher (more would publish each trajectory twice), nats and postgres — safe scaling without clustering.
- 2026-11-21 — Q5: manifests only reference Secrets by name; `deploy/k8s/create-secrets.sh` creates them with `kubectl create secret` from `.env` or random values, never writes a value to a file or log, and a human runs it — no secret in the repository, no extra tooling.

## Open questions
Round 2 (asked to the user):
- Q6 Replica baseline versus control-web "start = scale to 1", and what a re-apply does.
- Q7 Readiness and liveness probes while `/healthz` answers 503 when `degraded`.
- Q8 Persistence: PostgreSQL PVC and JetStream storage (compose uses tmpfs).
- Q9 Who creates the read-only viz-web DB user and its grants.
- Q10 How a store credentials change from the control page fits "the Secret is the source".

Later rounds (blocked on the answers above):
- M2, M4 and M5 specs are not written: the config-at-start-up rows and the real kubectl adapter depend on them.
- Resource requests and limits per service, `securityContext` exceptions (ROS2, JVM).
- Rollback procedure and the documented bring-up commands (where they live: `Makefile`, `deploy/k8s/README.md`).

## Task breakdown
Draft: rows and dependencies will change with the answers.
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | devops | [deploy] Kustomize base: namespace, ConfigMap, NATS and PostgreSQL StatefulSets with Services, `nats-init` Job | foundations#11, contracts#2 | - |
| 2 | devops | [deploy] Deployments and Services for the six services: probes, resources, securityContext, replicas | 1 | - |
| 3 | devops | [deploy] Ingress for `trajectory.local` | 2 | - |
| 4 | devops | [deploy] ServiceAccount, Role, RoleBinding for control-web | 1 | - |
| 5 | devops | [deploy] Secrets creation script, the read-only PostgreSQL user Job, no value in any file | 1 | - |
| 6 | backend | [propagator] Read the latest `config.propagator.set` at start-up, local file as fallback | M2 spec | - |
| 7 | backend | [store] Same for store, DB write credentials read from the Secret | M2 spec | - |
| 8 | backend | [ros2-publisher] Same for ros2-publisher | M5 spec | - |
| 9 | devops | [repo] Bring-up and rollback commands (`Makefile` targets), kubeconform in CI | 2, 3, 4, 5 | - |

## Readiness checklist
- [ ] goal, users and out of scope agreed
- [ ] every flow has its error and edge cases
- [ ] every screen has empty, loading, error and success states (no UI)
- [ ] contract changes written, breaking changes approved by the user (none expected)
- [ ] acceptance criteria are observable
- [ ] test seams agreed
- [ ] reuse decided: team libraries and new dependencies named, or "none"
- [ ] task breakdown with roles and dependencies
- [ ] no open questions
