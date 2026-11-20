---
name: web-workspace-manifest
description: Web server tasks may run before the web UI task, so backend may have to create the workspace package.json (frontend-owned) — how it was handled for control-web
metadata:
  type: project
---

Foundations rows 7/8 (viz-web / control-web servers, backend) depend only on row 1, so they can run before the frontend rows that create `services/<app>-web/package.json`. In #9 (control-web, 2026-11-20) backend created a minimal workspace manifest with namespaced `test:server` / `typecheck:server` scripts chained from `test` / `typecheck`, a separate `server/tsconfig.json` and `server/vitest.config.ts`, and recorded the hand-over in an alignment entry (`docs/alignment/2026-11-20-9.md`).

**Why:** root `npm test`/`typecheck` (`ci/npm-workspaces.sh`) only run scripts of workspaces that have a package.json; a nested package under `server/` would not be installed by `npm ci`.

**How to apply:** for the sibling task (viz-web server) check whether the manifest exists; if not, do the same and write the alignment entry. Port: server reads the existing `<APP>_PORT` var, no new env var invented. See [[team-boundaries]].
