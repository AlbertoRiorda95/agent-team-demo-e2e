---
feature: persistence
ready: yes
updated: 2026-11-24
owner: designer
milestone: M2
features: persistence
---

# Persistence: the Java store

## Goal
store keeps every computed trajectory in PostgreSQL forever: it consumes
`trajectories.computed`, writes the launch and its samples in one
transaction, idempotent on `launch_id`, and confirms on
`trajectories.stored`. It owns the schema (Flyway) and is its only writer. It
applies its own config (table prefix, DB write credentials encrypted in
transit and at rest) from `config.store.set`, and reports itself on
`status.store`. Success: after a 202 from api, the launch row and all its
samples are in the database and a `TrajectoryStored` with the right
`sample_count` is on the `TRAJECTORIES` stream; with PostgreSQL down nothing
is lost; a new table prefix or new credentials sent with the `nats` CLI are
in force without a restart, and the credentials are never in clear on a file,
a message or a log.

## Out of scope
- Reading the history and the read-only DB user with its grants (viewer, M3:
  a store migration row and a devops row there). The viewer learns the table
  prefix from the latest `config.store.applied`.
- The UI and server that send the store config (control-panel, M4): in M2 it
  is sent with the `nats` CLI or by the tests.
- Kubernetes Secrets as the source of the credentials and of the key (M6).
- Recording `accepted` and `failed` launches: store sees only computed
  trajectories.
- Deleting, expiring or moving history between prefixes: old tables are kept
  as they are.

## User flows
1. **Trajectory stored.** store pulls a `TrajectoryComputed` from its durable
   consumer on `trajectories.computed`, validates it, inserts the launch row
   (status `stored`) and its samples (COPY) in one transaction into the
   tables of the prefix in force, commits, publishes `TrajectoryStored`
   (JetStream, `Nats-Msg-Id` = launch_id) with the ack, then acks the input.
2. **Duplicate.** The launch_id is already in the tables of the prefix in
   force: nothing is written; store publishes `TrajectoryStored` again with
   the stored `sample_count` and acks (a store that crashed between commit
   and publish still confirms on redelivery).
3. **Database down.** The insert fails for a connection reason (SQL state
   class 08, or no connection): rollback, nak with a 5 s delay, the message
   waits in JetStream (no max deliver); status `degraded`; reconnection with
   the foundations backoff. The process never exits.
4. **Heartbeat.** Every 5 s a `ServiceStatus` on `status.store`: `ok`, or
   `degraded` with the reason (database, NATS, consumer, `STORE_CONFIG_KEY`
   missing); `config_version` = the version in force.
5. **New table prefix.** A `ConfigSet` with a `store` payload whose
   `table_prefix` differs: store runs the Flyway migrations for that prefix
   (tables `<prefix>launches`, `<prefix>trajectory_samples`, history table
   `<prefix>flyway_schema_history`); on success it saves the config, puts it
   in force (the next trajectories go to the new tables) and publishes
   `ConfigApplied` ok = true. On failure: ok = false with the reason, the
   prefix in force unchanged.
6. **New credentials.** A `ConfigSet` whose `db_credentials_sealed` is not
   empty: store decrypts it with `STORE_CONFIG_KEY`, opens a test connection
   with the new user and password; on success it switches its connections,
   saves the still-encrypted value in its local file and answers ok = true.
   Decryption or connection failure: ok = false, the old credentials stay.
   Empty `db_credentials_sealed`: the credentials in force are kept (a
   prefix-only change).
7. **Restart.** At start-up store reads its local file (none: prefix empty,
   the credentials of the environment, version 0), migrates the prefix in
   force, and publishes a `ConfigApplied` of the config in force.

Edge and error cases:
- A `TrajectoryComputed` that does not decode, has an empty `launch_id`, an
  enum at `*_UNSPECIFIED`, no samples, or a `seq` that is not 0..n−1:
  terminated, logged, `PipelineError` (service `store`, subject
  `trajectories.computed`); nothing written.
- A permanent database error on valid input (SQL state classes 22 and 23):
  rollback, terminated, `PipelineError`.
- A trajectory of 100000 samples (the cap) is stored in one transaction well
  within the ack wait (60 s).
- Two replicas get the same launch (redelivery): the primary key makes one
  insert win; the other sees the duplicate (flow 2).
- Config version: higher applied, equal re-acknowledged (ok = true, no
  change), lower rejected (`stale version`) — the same rule as propagation.
- An invalid `ConfigSet` (wrong `service`, no `store` payload, a prefix that
  does not match the pattern, sealed bytes too short): ok = false, nothing
  changes.
- `STORE_CONFIG_KEY` missing or not 32 bytes: store runs with the
  environment credentials, rejects every set that carries credentials (ok =
  false, `no config key`), applies prefix-only sets, status `degraded`.
- A config set while a trajectory is being written: the write finishes with
  the config it started with.
- Local file unreadable, corrupt or not decryptable: log it (never its
  content), start as with no file, status `degraded` until a valid set is
  applied.

## Screens and states
None (no UI).

## Data and API
Migration `V2__launches_and_samples.sql` (additive; its reverse in a comment,
as V1), with the Flyway placeholder `${prefix}` in every table, index and
constraint name; the history table of each prefix is
`<prefix>flyway_schema_history`. Default prefix: empty (`launches`,
`trajectory_samples`).

`<prefix>launches`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | launch_id |
| received_at | timestamptz not null | accepted_at |
| computed_at | timestamptz not null | |
| stored_at | timestamptz not null default now() | |
| mass_kg, x_m, y_m, z_m, azimuth_deg, elevation_deg, force_n, burn_duration_s | double precision not null | the request |
| propagation_time_s, sample_step_s, gravity_mps2 | double precision not null | the config snapshot |
| config_version | bigint not null | of the snapshot |
| status | text not null, check in (accepted, computed, stored, failed) | M2 writes only `stored` |
| end_reason | text not null, check in (ground, time_limit) | |
| flight_time_s, max_height_m, range_m | double precision not null | |
| sample_count | integer not null | |
Index on `received_at desc` (the history list, newest first).

`<prefix>trajectory_samples`
| Column | Type | Notes |
|---|---|---|
| launch_id | uuid FK → launches(id) | |
| seq | integer | PK (launch_id, seq) |
| t_s, x_m, y_m, z_m, vx_mps, vy_mps, vz_mps | double precision not null | |
| phase | text not null, check in (burn, ballistic) | |

Contract change (backend, `proto/trajectory/v1/config.proto`, additions only):
```proto
message StoreConfig {
  // Empty, or ^[a-z][a-z0-9_]{0,15}$, used as is: "demo_" gives demo_launches.
  string table_prefix = 1;
  // AES-256-GCM with STORE_CONFIG_KEY: 12-byte nonce || ciphertext || 16-byte tag,
  // additional data "trajectory.v1.StoreConfig". Plaintext: UTF-8 JSON
  // {"user": "...", "password": "..."}. Empty in a ConfigSet: keep the current
  // credentials. Always empty in a ConfigApplied (write-only).
  bytes db_credentials_sealed = 2;
}
// ConfigSet:     oneof payload { PropagatorConfig propagator = 3; StoreConfig store = 4; }
// ConfigApplied: oneof payload { PropagatorConfig propagator = 7; StoreConfig store = 8; }
```
`proto/README.md` documents the payload and the sealing; the regenerated code
ships in `@albertoriorda95/trajectory-proto` 0.2.0 (control-web needs it in
M4; the user pushes the tag). Breaking for existing clients: no (new message,
new oneof members).

Key: `STORE_CONFIG_KEY`, base64 of 32 random bytes (`openssl rand -base64
32`), held only by store and, from M4, the control-web server; in `.env`
(compose), a Kubernetes Secret in M6. It never appears in a log.

Local file: JSON `{"config_version", "table_prefix", "db_credentials_sealed"
(base64, may be absent)}` at `STORE_CONFIG_PATH` (default
`/var/lib/store/config.json`), written to a temporary file and renamed. The
credentials stay sealed in the file; they are decrypted only in memory.
Precedence: the sealed credentials of the file, else `DATABASE_USER` and
`DATABASE_PASSWORD`.

NATS objects: durable pull consumer `store` on the `TRAJECTORIES` stream,
filter `trajectories.computed`, explicit ack, ack wait 60 s, shared by the
replicas (M6). Config: a subscription to `config.store.set` per instance,
delivering only new messages (M6: the latest message of the stream at
start-up).

Environment: `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD`, `NATS_URL`
(existing); new `STORE_CONFIG_PATH`, `STORE_CONFIG_KEY`.

Logs: one JSON line per trajectory (launch_id, outcome, samples, duration)
and per config set (version, ok, prefix); credentials and the key never
logged.

`docs/api/` unchanged.

## Acceptance criteria
- [ ] Integration (PostgreSQL and NATS in Testcontainers): a `TrajectoryComputed` with 6001 samples produces one launch row with every field and status `stored`, 6001 sample rows equal to the message, one `TrajectoryStored` with `sample_count` 6001 and `Nats-Msg-Id` = launch_id; the input is acked.
- [ ] The same message twice: still one launch row and 6001 samples; a second `TrajectoryStored` is published (JetStream may drop it within 2 min).
- [ ] An invalid message: a `PipelineError`, no row, no redelivery.
- [ ] PostgreSQL stopped, a message published, PostgreSQL started: the trajectory is stored without restarting store; `status.store` is `degraded` meanwhile.
- [ ] A 100000-sample trajectory is stored and confirmed in under 10 s on the CI runner.
- [ ] `status.store` receives a heartbeat every 5 s (± 1 s).
- [ ] `MigrationTest`: V2 applies on an empty database, on the V1 baseline, and for a second prefix next to the first.
- [ ] A `ConfigSet` with prefix `demo_`: `ConfigApplied` ok = true, the tables `demo_launches` and `demo_trajectory_samples` exist, the next trajectory is in them and the old tables are unchanged.
- [ ] A `ConfigSet` with sealed credentials of a second database user: ok = true and the next trajectory is written by that user; with a wrong password or bytes sealed with another key: ok = false and the next trajectory is still stored with the old user.
- [ ] Every `ConfigApplied` from store has an empty `db_credentials_sealed`; no log line, file or message contains the password in clear (the test greps the logs and the file for it).
- [ ] After a restart store uses the prefix and the credentials of its local file and publishes a `ConfigApplied` with their version.
- [ ] A lower `config_version`: ok = false `stale version`; the same version: ok = true, nothing changes.
- [ ] `npx buf lint` and `npx buf breaking` pass; `npm test -w libs/trajectory-proto` round-trips a `ConfigSet` with a `store` payload.

## Test seams
- Integration: the store's message and config handlers against PostgreSQL and NATS in Testcontainers: catches the schema, the transaction, idempotency, ack/nak/term, errors, prefix migrations, credential switches and the heartbeat; misses compose wiring.
- Migration: Flyway on a fresh PostgreSQL container, two prefixes: catches SQL, placeholders and ordering errors.
- Unit: the mapping `TrajectoryComputed` → rows, the validation, the sealing (decrypt with the right key, reject a wrong key or tampered bytes) and the local file: fast feedback on fields and crypto; misses SQL and NATS.
- Contract: `buf lint`, `buf breaking`, the library round-trip: catches incompatible proto edits.

## Reuse
- jnats 2.27.0, Flyway 13.13.0 (placeholders, per-prefix history table), pgjdbc 42.7.14, Testcontainers PostgreSQL: from foundations.
- Protobuf runtime for Java: `com.google.protobuf:protobuf-java` at the version of the generated code (v33.1); generated Java code committed in the service, as api does for Python.
- NATS in tests: Testcontainers `GenericContainer` with the pinned `nats` image (no new library).
- Bulk insert of samples: pgjdbc's `CopyManager` (COPY, built into the driver).
- Encryption: `javax.crypto` AES/GCM (JDK, no new dependency); `node:crypto` on the control-web side in M4.
- JSON for the local file and the credentials plaintext: jnats' own `io.nats.client.support.JsonParser` / `JsonValue` (already a dependency); the store's existing `JsonLog` for the logs.

## Decisions
- 2026-11-24 — store owns the schema and is its only writer; history kept forever — project.md.
- 2026-11-24 — A duplicate launch_id writes nothing but publishes `TrajectoryStored` again — a crash between commit and publish still gets confirmed.
- 2026-11-24 — The whole store config (table prefix and sealed credentials) in M2, as a new `StoreConfig` payload — the brief asks the Java processor to follow table format and credentials; M4 only adds the UI and server.
- 2026-11-24 — A new prefix migrates its own tables and Flyway history; old tables kept — Flyway placeholders, no data moved, history kept forever.
- 2026-11-24 — Credentials sealed with AES-256-GCM and `STORE_CONFIG_KEY`, held only by store and the control-web server; the same ciphertext kept at rest; never echoed in `ConfigApplied` — encrypted in transit and at rest with built-in crypto, write-only.
- 2026-11-24 — New credentials applied only after a test connection succeeds — a typo must not stop the pipeline.
- 2026-11-24 — M2 writes only status `stored`; the column keeps the four values — store sees only computed trajectories (project.md flow 3).
- 2026-11-24 — Samples inserted with COPY (pgjdbc `CopyManager`) — fastest for 100000 rows, no new dependency.
- 2026-11-24 — Config version rule and start-up `ConfigApplied` as in propagation — one behavior for every configurable service.
- 2026-11-24 — The read-only user and its grants are deferred to the viewer spec (M3) — it is the one that needs them.

## Open questions
- (none)

## Task breakdown
| # | Role | Task | Depends on | Issue |
|---|---|---|---|---|
| 1 | backend | [proto] `StoreConfig` payload (`table_prefix`, `db_credentials_sealed`) in the `ConfigSet` and `ConfigApplied` oneofs, `proto/README.md` (payload, sealing, write-only), regenerated code, `@albertoriorda95/trajectory-proto` 0.2.0 with a round-trip test | — | - |
| 2 | backend | [store] Migration V2 with the `${prefix}` placeholder, the committed generated Java code of `trajectory.v1` and protobuf-java, the durable consumer on `trajectories.computed`, the transaction with COPY, `TrajectoryStored`, nak/term and `PipelineError`, `status.store` heartbeat, Testcontainers tests with PostgreSQL and NATS | — | - |
| 3 | backend | [store] The config: `config.store.set` with the version rule, prefix migration, sealed credentials (AES-256-GCM, `STORE_CONFIG_KEY`) with a test connection, encrypted local file at `STORE_CONFIG_PATH`, `config.store.applied` (credentials never echoed), start-up from the file, tests | 1, 2 | - |
| 4 | devops | [repo] compose: a named writable volume for `STORE_CONFIG_PATH` of store, `STORE_CONFIG_KEY` passed from `.env`, `.env.example` with the variable and how to generate it | propagation#2 | - |

## Readiness checklist
- [x] goal, users and out of scope agreed
- [x] every flow has its error and edge cases
- [x] every screen has empty, loading, error and success states (no UI)
- [x] contract changes written, breaking changes approved by the user (none: additions only)
- [x] acceptance criteria are observable
- [x] test seams agreed
- [x] reuse decided: team libraries and new dependencies named, or "none"
- [x] task breakdown with roles and dependencies
- [x] no open questions
