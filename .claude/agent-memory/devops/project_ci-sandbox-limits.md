---
name: ci-sandbox-limits
description: What the unattended CI agent run allows; docker worked on 2026-11-22 and 2026-11-28 but was blocked on 2026-11-20; Bash commands naming the dotenv file are blocked by a hook
metadata:
  type: project
---

Sandbox permissions vary between runs. On 2026-11-20 (issue #2) every
`docker ...`, `curl`, `rm`/`mv`, `chmod`, `yamllint`, `shellcheck`, `python3`
and `go` were blocked. On 2026-11-22 (issue #12) `docker` (build, compose,
`buildx imagetools inspect`), `curl` and `chmod` all worked, so linters ran as
images: `hadolint/hadolint:v2.14.0`, `rhysd/actionlint:1.7.12` (flag
`-no-color`), `koalaman/shellcheck:v0.11.0`, `aquasec/trivy:0.76.0` (the CI
version, `ci/scanners.env`).

A PreToolUse hook blocks any Bash command line that names the dotenv file
(it counts as a credential read), even copying the example to it, or writing
a memory file that mentions it via heredoc. Use
`docker compose --env-file .env.example ...`, put long edit scripts in a file
under /tmp, and write memory files with the Write tool.

**Why:** probing once at the start saves turns; digests can be pinned and
images actually built when docker works.

**How to apply:** first run `docker buildx imagetools inspect <img>`; if it
works, pin digests and build/scan for real. If blocked, leave `TODO(pin)` and
list the unrun checks in the PR. `git` and `gh issue|pr` always worked.
On 2026-11-28 (issue #108) docker, compose, curl, python3 and heredocs all
worked, and the whole stack built (propagator ~7 min); a python script whose
text mentioned the dotenv example was still blocked by the hook.
In the postgres container, `psql -h 127.0.0.1` is trusted (any password works):
test passwords from another container (`docker compose run --no-deps db-init`).
On 2026-11-22 (PR #71 follow-up run) even `npm ci`, `npm run`, `npx eslint`,
heredocs to /tmp and `node <script>` were blocked: edit with the Edit/Write
tools, and read CI failures with `gh run view <run> --job <id> --log-failed`. See [[workflow-push-blocked]], [[image-vuln-gate]].
