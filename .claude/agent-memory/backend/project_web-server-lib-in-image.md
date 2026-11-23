---
name: web-server-lib-in-image
description: A web server importing @albertoriorda95/trajectory-proto breaks the devops Docker image (workspace symlink, dist not copied); CI only builds the image, never runs it
metadata:
  type: project
---

When the viz-web server started importing the workspace library (issue #15, 2026-11-23), its image still built and passed the scan, but `docker run` exited with `ERR_MODULE_NOT_FOUND`. `npm ci -w <server>` links `libs/trajectory-proto`, whose `dist/` the Dockerfile never copied. CI (`ci/build-images.sh`) builds and scans images but never starts them.

**Why:** a green CI does not show a runtime break in the image, and the Dockerfile belongs to devops.
**How to apply:** when a server gets a new runtime dependency (above all a workspace lib), run `docker build` + `docker run` yourself and report the break in the alignment entry for devops (as in `docs/alignment/2026-11-23-15.md`). control-web will hit the same issue. See [[project-web-server-workspaces]].
