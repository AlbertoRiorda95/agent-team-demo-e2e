#!/usr/bin/env bash
# ci/reference.sh: builds the reference documentation from the code, with the
# stack's own generators, the same on GitHub and GitLab and on your computer.
#   ci/reference.sh        every generator that applies to this project
# It writes to $REFERENCE_DIR (reports/reference/), which the CI saves as the
# artifact "reference-docs". Nothing is committed: the writer agent's documents
# link to it. A generator that does not apply is skipped; one that applies and
# fails fails the job.
set -euo pipefail
cd "$(dirname "$0")/.."
source ci/scanners.env
OUT=${REFERENCE_DIR:-reports/reference}
mkdir -p "$OUT"
built=0

# API contract (OpenAPI) -> one HTML page. build-docs renders even an invalid
# contract: lint it first, with the project's redocly.yaml if there is one,
# else only the structural rules (minimal)
if [ -f docs/api/openapi.yaml ]; then
  if [ -f redocly.yaml ]; then lint=(); else lint=(--extends=minimal); fi
  npx --yes "@redocly/cli@$REDOCLY_VERSION" lint "${lint[@]}" docs/api/openapi.yaml
  npx --yes "@redocly/cli@$REDOCLY_VERSION" build-docs docs/api/openapi.yaml -o "$OUT/api/index.html"
  built=1
fi

# TypeScript: the proto library -> typedoc (its tsconfig.json; typedoc.json if present)
if [ -f libs/trajectory-proto/tsconfig.json ]; then
  (cd libs/trajectory-proto &&
   npx --yes "typedoc@$TYPEDOC_VERSION" --entryPointStrategy expand --out "../../$OUT/trajectory-proto" src)
  built=1
fi

# Python: services/api -> pdoc (PYTHON_PACKAGE under services/api/src/), with the
# service's own dependencies so that pdoc can import it
if [ -f services/api/pyproject.toml ] && [ -n "${PYTHON_PACKAGE:-}" ]; then
  (cd services/api && uv sync --frozen &&
   PYTHONPATH=src uv run --with "pdoc==$PDOC_VERSION" pdoc -o "../../$OUT/api-python" "$PYTHON_PACKAGE")
  built=1
fi

# Java: services/store -> javadoc
if [ -f services/store/gradlew ]; then
  (cd services/store && ./gradlew --quiet javadoc)
  mkdir -p "$OUT/store-java"
  cp -r services/store/build/docs/javadoc/. "$OUT/store-java/"
  built=1
fi

# C++: services/propagator -> doxygen, when the service has a Doxyfile
if [ -f services/propagator/Doxyfile ] && command -v doxygen >/dev/null; then
  (cd services/propagator && OUTPUT_DIRECTORY="../../$OUT/propagator-cpp" doxygen Doxyfile)
  built=1
fi

if [ "$built" = 0 ]; then
  echo "reference: no generator applies to this project (see ci/reference.sh)."
fi
