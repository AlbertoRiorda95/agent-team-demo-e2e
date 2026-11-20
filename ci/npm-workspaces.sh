#!/usr/bin/env bash
# ci/npm-workspaces.sh <script>: run an npm script in every workspace that
# defines it (`npm run <script> --workspaces --if-present`). The workspaces of
# the root package.json arrive one task at a time; while none of them exists
# yet, npm fails with "No workspaces found!", so this says so and succeeds.
set -euo pipefail
script=${1:?usage: ci/npm-workspaces.sh <script>}
present=$(node -e '
  const fs = require("node:fs");
  const ws = JSON.parse(fs.readFileSync("package.json", "utf8")).workspaces ?? [];
  console.log(ws.filter((w) => fs.existsSync(`${w}/package.json`)).length);
')
if [ "$present" = 0 ]; then
  echo "npm-workspaces: no workspace exists yet, nothing to $script"
  exit 0
fi
exec npm run "$script" --workspaces --if-present
