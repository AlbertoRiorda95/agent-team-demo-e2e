#!/usr/bin/env bash
# ci/build-images.sh: build the image of every service that has a Dockerfile
# (services/<name>/Dockerfile) and scan it with trivy. Built locally only,
# never pushed.
# Every Dockerfile is built with the repository root as its context (the web
# apps are npm workspaces of the root package.json, and the services will
# need proto/); each one has its own services/<name>/Dockerfile.dockerignore.
# Reports: reports/trivy-image-<name>.json. Fails when an image has a finding
# of severity TRIVY_FAIL_SEVERITY (ci/scanners.env).
# Usage: ci/build-images.sh [name...]   (default: every service)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=ci/scanners.env
source ci/scanners.env
export PATH="$HOME/.local/bin:$PATH"    # where ci/install-scanners.sh puts trivy
mkdir -p reports

if [ "$#" -gt 0 ]; then
  names=("$@")
else
  names=()
  for df in services/*/Dockerfile; do
    [ -f "$df" ] && names+=("$(basename "$(dirname "$df")")")
  done
fi
if [ "${#names[@]}" -eq 0 ]; then
  echo "build-images: no services/*/Dockerfile yet, nothing to build"
  exit 0
fi

status=0
for svc in "${names[@]}"; do
  echo "::group::$svc"
  docker build --file "services/$svc/Dockerfile" --tag "$svc:ci" .
  trivy image --format json --output "reports/trivy-image-$svc.json" "$svc:ci"
  trivy image --severity "$TRIVY_FAIL_SEVERITY" --exit-code 1 "$svc:ci" || status=1
  echo "::endgroup::"
done
exit "$status"
