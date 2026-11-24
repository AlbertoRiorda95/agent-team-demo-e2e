# store

Consumes the computed trajectories from NATS and keeps them in PostgreSQL
(`docs/design/persistence.md`). The schema is managed by Flyway
(`src/main/resources/db/migration/`, additive and reversible migrations only).

At start-up it reads its local config file, applies the migrations of the
table prefix in force, connects to NATS, starts the `status.store` heartbeat,
subscribes to `config.store.set`, publishes a `ConfigApplied` of the config in
force and creates the durable consumer `store`; then it pulls the trajectories
one at a time.

## What it does with a message
Durable pull consumer `store` on the stream `TRAJECTORIES`, filter
`trajectories.computed`, explicit ack, ack wait 60 s, no max deliver (created by
the store, shared by the replicas).
| Case | Database | NATS |
|---|---|---|
| Valid, new launch_id | one transaction: the `launches` row (status `stored`) and the samples (COPY) | `TrajectoryStored` on `trajectories.stored` (JetStream, `Nats-Msg-Id` = launch_id), then ack |
| Valid, launch_id already stored | nothing written | `TrajectoryStored` again with the stored `sample_count`, then ack |
| Does not decode, empty or non-UUID launch_id, a missing timestamp/request/config, an enum at `*_UNSPECIFIED`, no samples, `seq` not 0..n−1 | nothing written | term, `PipelineError` on `pipeline.errors` |
| SQL state class 22 or 23 | rolled back | term, `PipelineError` |
| Any other database failure (class 08, no connection, shutdown) | rolled back | nak with a 5 s delay, `degraded`, pause with the backoff |

One JSON log line per trajectory: `launch_id`, `outcome` (`stored`,
`duplicate`, `rejected`, `retry`, `not confirmed`), `samples`, `duration_ms`.

## Heartbeat
Every 5 s a `ServiceStatus` on `status.store` (core NATS): `ok`, or `degraded`
with the reasons in `detail` (`database unavailable`, `not connected to NATS`,
`consumer not ready`, `STORE_CONFIG_KEY missing or invalid`, `local config file
invalid`), joined by "; ". `config_version` is the version in force.

## Config
Each instance subscribes to `config.store.set` (core NATS, new messages only)
and answers every `ConfigSet` with a `ConfigApplied` on `config.store.applied`:
the config now in force (`table_prefix`), `db_credentials_sealed` always empty
(write-only, `proto/README.md` > Store config).

| Set | Answer |
|---|---|
| Not a `ConfigSet`, `service` not `store`, no `store` payload, prefix not empty nor `^[a-z][a-z0-9_]{0,15}$`, sealed bytes shorter than 29 | ok = false, nothing changes |
| `config_version` lower than the one in force | ok = false, `stale version` |
| `config_version` equal to the one in force | ok = true, nothing changes |
| Sealed credentials, `STORE_CONFIG_KEY` missing or invalid | ok = false, `no config key` |
| Sealed credentials that do not decrypt, or whose test connection fails | ok = false, the old credentials stay |
| Higher version, valid | test connection (new credentials), migrations of a new prefix, local file saved, then in force: ok = true |

Empty `db_credentials_sealed` keeps the credentials in force (a prefix-only
change). A new prefix gets its own tables and Flyway history; the old tables
are kept as they are. A trajectory being written finishes with the config it
started with. One JSON log line per set: `config_version`, `ok`,
`table_prefix`, `changed`, `error`.

Local file at `STORE_CONFIG_PATH`: JSON `{"config_version", "table_prefix",
"db_credentials_sealed"}` (base64, absent for the environment credentials),
written to a temporary file in the same folder and renamed. The credentials stay
sealed in it and are decrypted only in memory. No file: version 0, no prefix, the
environment credentials. A file that is unreadable, corrupt or does not decrypt
is logged (never its content) and ignored, with `degraded` until a set is
applied.

## Schema
`V2__launches_and_samples.sql`: `<prefix>launches` and
`<prefix>trajectory_samples`, with the Flyway placeholder `${prefix}` in every
table, index and constraint name, and one Flyway history per prefix
(`<prefix>flyway_schema_history`). The default prefix is empty (the tables
`launches` and `trajectory_samples`); `config.store.set` changes it.

## Generated code
The Java code of `proto/trajectory/` is committed in `src/main/generated/`
(runtime `protobuf-java` 4.33.1, the version of the buf plugin). After a change
to `proto/`: `scripts/generate-proto.sh` (needs `npm ci` at the root and access
to buf.build); `scripts/generate-proto.sh --check` fails when it is stale.

## Commands (from this folder)
- Build and test: `./gradlew build` (the tests use Testcontainers: Docker needed).
- One class: `./gradlew test --tests '<Class>'`.
- Run: `./gradlew installDist && build/install/store/bin/store`.

## Configuration (environment)
| Variable | Required | Example |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://localhost:5432/trajectory` (also `jdbc:postgresql://...`; no credentials in the URL) |
| `DATABASE_USER` | yes | `trajectory` (used when the local file holds no sealed credentials) |
| `DATABASE_PASSWORD` | yes | (never logged) |
| `NATS_URL` | no | `nats://localhost:4222` (the default) |
| `STORE_CONFIG_PATH` | no | `/var/lib/store/config.json` (the default; the folder must be writable) |
| `STORE_CONFIG_KEY` | no, but without it the store is `degraded` and refuses sealed credentials | base64 of 32 random bytes: `openssl rand -base64 32` (never logged) |

An invalid configuration logs `invalid configuration` and exits with code 2.
PostgreSQL or NATS unreachable at start-up: the service logs the error with
`"health":"degraded"` and retries with backoff (0.5 s doubling up to 30 s); it
never crashes. Logs are one JSON object per line on standard error.
