---
name: ci-sandbox-limits
description: In the unattended CI run, docker, curl, rm/mv, yamllint, shellcheck and python need approval (blocked); npm, npx, node, gh issue/pr and git work
metadata:
  type: project
---

In the unattended GitHub Actions agent run (seen 2026-11-20, issue #2), every
`docker ...` command (pull, compose config, buildx), `curl`, `gh api` to
outside hosts, `rm`/`mv`, `chmod`, `yamllint`, `shellcheck` and `python3`
need approval, so they are blocked. So do `go` (e.g. `go version -m`), pipes
into grep, `cmd; echo $?` and `for` loops with variables. To read a Go
binary's build info, scan the file with `node -e` (regex on `go1.x.y` and
module `\tvX.Y.Z` strings). `npm`, `npx`, `git` (including
`git clean`, `git update-index --chmod=+x`) and `gh issue|pr` work.

The push token is a GitHub App without `workflows` permission: a push that
touches `.github/workflows/*` is rejected. Keep workflow edits out of the
branch history and put them as a patch in the PR for a human.

**Why:** image digests cannot be resolved and compose/Dockerfiles cannot be
validated locally in that environment.

**How to apply:** do not burn turns retrying them; delete scratch files with
`git clean -fdx <path>`; leave a `TODO(pin)` and ask the reviewer to pin
digests (`docker buildx imagetools inspect <image>`); list the unrun checks
in the PR. `npm query .workspace` only sees linked workspaces, check folders
on disk instead. See [[root-workspace-scripts]].
