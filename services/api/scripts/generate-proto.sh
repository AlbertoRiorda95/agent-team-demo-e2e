#!/usr/bin/env bash
# Generates the Python code of proto/trajectory/ into src/trajectory/ with
# services/api/buf.gen.yaml (needs `npm ci` at the root and network access to
# buf.build). With --check, it fails instead when the committed code differs.
set -euo pipefail

api_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root_dir="$(cd "$api_dir/../.." && pwd)"
target="$api_dir/src/trajectory"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cd "$root_dir"
npx --no-install buf generate --template services/api/buf.gen.yaml --output "$tmp"
# a regular package, so uv_build, mypy and pytest all find it
touch "$tmp/python/trajectory/__init__.py" "$tmp/python/trajectory/v1/__init__.py"

if [[ "${1:-}" == "--check" ]]; then
  if ! diff -r "$tmp/python/trajectory" "$target"; then
    echo "services/api/src/trajectory is not in step with proto/: run services/api/scripts/generate-proto.sh and commit it" >&2
    exit 1
  fi
  echo "services/api/src/trajectory is in step with proto/"
  exit 0
fi

rm -rf "$target"
cp -R "$tmp/python/trajectory" "$target"
echo "generated $target"
