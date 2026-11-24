#!/usr/bin/env bash
# ci/nats-test.sh: a NATS server with JetStream and the streams of
# proto/nats/streams/ applied, for integration tests (NATS_TEST_URL).
# It reuses the `nats` and `nats-init` services of compose.yml, so CI and
# local development run the same pinned image and the same nats.conf.
#
#   ci/nats-test.sh up     # start NATS, create the streams; prints NATS_TEST_URL
#   ci/nats-test.sh down   # stop and remove the NATS containers
#
# NATS listens on 127.0.0.1:${NATS_PORT:-4222}. Run from any folder.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# compose.yml requires the PostgreSQL variables even for unrelated services:
# the development placeholders of .env.example are enough (no secret).
compose() {
  docker compose --project-directory "$root" -f "$root/compose.yml" \
    --env-file "$root/.env.example" "$@"
}

case "${1:-}" in
  up)
    # --wait: returns once the healthcheck (JetStream enabled) passes
    compose up -d --wait --wait-timeout 60 nats
    # one-shot: creates the streams that do not exist yet, exits non-zero on error
    compose run --rm --no-deps nats-init
    echo "NATS_TEST_URL=nats://127.0.0.1:${NATS_PORT:-4222}"
    ;;
  down)
    compose rm -sf nats nats-init
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
