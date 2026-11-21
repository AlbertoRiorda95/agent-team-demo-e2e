---
name: workflow-push-blocked
description: the unattended CI run's GitHub App token cannot push changes to .github/workflows/ (no `workflows` permission); hook also blocks words like "npm publish" in gh comment bodies
metadata:
  type: project
---

In the unattended CI run, `git push` is rejected for any commit touching `.github/workflows/*`
("refusing to allow a GitHub App to create or update workflow ... without `workflows` permission").
Seen on issue #64 (2026-11-21).

**Why:** the agent's GitHub App token lacks the `workflows` scope; this is a permission
boundary, not something to work around.

**How to apply:** if a task needs a workflow edit, put the non-workflow parts (ci/ scripts) in the PR,
paste the workflow diff in the PR description for a human to apply, and use "Refs #N" instead of
"Closes #N" when the issue is only partly done. Also: the infra-command hook scans the
whole Bash command line, so pass gh comment/PR bodies with `--body-file` (words like
"npm publish" or "~/.npmrc" in an inline body get blocked). See [[ci-sandbox-limits]].
