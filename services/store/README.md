# store

Consumes the computed trajectories from NATS and keeps them in PostgreSQL
(`docs/design/persistence.md`). The schema is managed by Flyway
(`src/main/resources/db/migration/`, additive and reversible migrations only).

At start-up it applies the migrations, connects to NATS, starts the
`status.store` heartbeat and creates the durable consumer `store`; then it
pulls the trajectories one at a time.

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
`consumer not ready`). `config_version` is 0 until the store config lands
(issue #92).

## Schema
`V2__launches_and_samples.sql`: `<prefix>launches` and
`<prefix>trajectory_samples`, with the Flyway placeholder `${prefix}` in every
table, index and constraint name, and one Flyway history per prefix
(`<prefix>flyway_schema_history`). The prefix is empty for now (the tables
`launches` and `trajectory_samples`); `config.store.set` changes it in #92.

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
| `DATABASE_USER` | yes | `trajectory` |
| `DATABASE_PASSWORD` | yes | (never logged) |
| `NATS_URL` | no | `nats://localhost:4222` (the default) |

An invalid configuration logs `invalid configuration` and exits with code 2.
PostgreSQL or NATS unreachable at start-up: the service logs the error with
`"health":"degraded"` and retries with backoff (0.5 s doubling up to 30 s); it
never crashes. Logs are one JSON object per line on standard error.
