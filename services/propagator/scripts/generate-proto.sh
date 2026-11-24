#!/usr/bin/env bash
# Generates the C++ code of proto/trajectory/ into src/gen/trajectory/ with
# services/propagator/buf.gen.yaml (needs `npm ci` at the root and network
# access to buf.build). With --check, it fails instead when the committed code
# differs.
set -euo pipefail

service_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root_dir="$(cd "$service_dir/../.." && pwd)"
target="$service_dir/src/gen/trajectory"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cd "$root_dir"
npx --no-install buf generate --template services/propagator/buf.gen.yaml --output "$tmp"

if [[ "${1:-}" == "--check" ]]; then
  if ! diff -r "$tmp/cpp/trajectory" "$target"; then
    echo "services/propagator/src/gen/trajectory is not in step with proto/: run services/propagator/scripts/generate-proto.sh and commit it" >&2
    exit 1
  fi
  echo "services/propagator/src/gen/trajectory is in step with proto/"
  exit 0
fi

rm -rf "$target"
mkdir -p "$(dirname "$target")"
cp -R "$tmp/cpp/trajectory" "$target"
echo "generated $target"
