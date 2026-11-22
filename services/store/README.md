# store

Consumes the trajectory messages from NATS and keeps them in PostgreSQL. The
schema is managed by Flyway (`src/main/resources/db/migration/`, additive and
reversible migrations only). Foundations skeleton: at start-up it applies the
migrations, then connects to NATS; no messages are consumed yet.

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
PostgreSQL or NATS unreachable: the service logs the error with
`"health":"degraded"` and retries with backoff (0.5 s doubling up to 30 s); it
never crashes. Logs are one JSON object per line on standard error.
