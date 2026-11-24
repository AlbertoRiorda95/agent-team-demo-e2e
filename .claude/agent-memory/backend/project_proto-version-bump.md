---
name: proto-version-bump
description: Bumping @albertoriorda95/trajectory-proto requires bumping the exact-pinned workspace deps and package-lock.json, else npm ci fails
metadata:
  type: project
---

The viz-web server pins `@albertoriorda95/trajectory-proto` exactly (`"0.1.0"`), so the 0.2.0 bump (issue #90, 2026-11-24) made `npm ci` fail ("Missing ... from lock file") until the server dep was bumped and `npm install --package-lock-only --ignore-scripts` refreshed the lockfile (two version lines only).
api commits its own Python gencode (`services/api/scripts/generate-proto.sh --check`); CI does not enforce it, so a proto change leaves it behind unless regenerated.

**Why:** a version bump that looks local breaks every workspace install.
**How to apply:** on each lib version bump, grep the `*/package.json` files for the old version, bump them and the lockfile, then run `npm ci`. For a proto change, note the api gencode drift in the alignment entry. See [[web-server-lib-in-image]].
