#!/bin/bash
# scripts/hooks/gate-test.sh: the task cannot be closed while a test suite fails.
# Runs the tests of every service that already exists (AGENTS.md > Commands).
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
: > /tmp/test.log
fail=0
run() {  # run <folder> <command...>: only if the folder exists
  local dir=$1; shift
  [ -e "$dir" ] || return 0
  if ! (cd "$dir" && "$@") >> /tmp/test.log 2>&1; then
    echo "FAILED in $dir: $*" >> /tmp/test.log; fail=1
  fi
}
[ -f package.json ] && run . npm test --workspaces --if-present --silent
[ -f services/api/pyproject.toml ] && run services/api uv run pytest -q
[ -f services/store/gradlew ] && run services/store ./gradlew test --quiet
[ -f services/propagator/CMakePresets.json ] && [ -d services/propagator/build ] && \
  run services/propagator ctest --preset release --output-on-failure
if [ "$fail" = 1 ]; then
  echo "Task cannot be closed: the test suite fails." >&2
  tail -n 30 /tmp/test.log >&2
  exit 2
fi
exit 0
