---
name: project-web-server-workspaces
description: The viz-web/control-web servers are their own npm packages in services/*-web/server/; becoming root workspaces needs devops (root package.json)
metadata:
  type: project
---

The web servers (`services/viz-web/server/`, `services/control-web/server/`) are backend's, but the
npm workspace `services/<app>-web/package.json` is frontend's and the root `package.json`/lockfile
is devops's. So each server is its own private package (`@trajectory/<app>-web-server`) and
devops must add `services/<app>-web/server` to the root `workspaces` (alignment entry
`docs/alignment/2026-11-20-8.md`, issue #8).

**Why:** two roles never edit the same file; frontend's task 9 creates the viz-web package.json in parallel.
**How to apply:** check whether the root workspaces already list the server; if not, verify locally
with a temporary, uncommitted workspace entry (restore package.json and package-lock.json after) and
raise an alignment entry instead of editing those files.
