#!/usr/bin/env bash
# Generates the Java code of proto/trajectory/ into src/main/generated/ with
# services/store/buf.gen.yaml (needs `npm ci` at the root and network access to
# buf.build). With --check, it fails instead when the committed code differs.
set -euo pipefail

store_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root_dir="$(cd "$store_dir/../.." && pwd)"
target="$store_dir/src/main/generated"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cd "$root_dir"
npx --no-install buf generate --template services/store/buf.gen.yaml --output "$tmp"

if [[ "${1:-}" == "--check" ]]; then
  if ! diff -r "$tmp/java" "$target"; then
    echo "services/store/src/main/generated is not in step with proto/: run services/store/scripts/generate-proto.sh and commit it" >&2
    exit 1
  fi
  echo "services/store/src/main/generated is in step with proto/"
  exit 0
fi

rm -rf "$target"
cp -R "$tmp/java" "$target"
echo "generated $target"
