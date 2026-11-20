#!/bin/bash
# scripts/hooks/lint-frontend.sh: lint only the file that was just edited (web apps)
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
case "$FILE" in
  */services/viz-web/*|*/services/control-web/*|*/e2e/*|*/packages/*)
    case "$FILE" in
      *.ts|*.tsx|*.js|*.mjs|*.vue) npx eslint --fix "$FILE" >/dev/null 2>&1 || true ;;
    esac ;;
esac
exit 0
