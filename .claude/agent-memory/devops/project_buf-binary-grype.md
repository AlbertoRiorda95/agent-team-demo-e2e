---
name: buf-binary-grype
description: The CI vulnerabilities job flags Go modules inside the @bufbuild/buf npm binary; a scoped grype ignore for GO-2026-6860 expires 2027-01-19
metadata:
  type: project
---

`sbom-licenses` runs `npm ci --ignore-scripts` and `syft dir:.`, so the Go
binary in `node_modules/@bufbuild/buf-linux-x64/bin/buf` is in the SBOM.
On 2026-11-20 (PR #54), buf 1.75.0 (the newest) shipped `golang.org/x/net
v0.61.0` (GO-2026-6860, High) and go1.27.3, so `vulnerabilities` went red.

Decision (user, PR #54, option b): `.grype.yaml` at the repo root ignores
GO-2026-6860 only, for `golang.org/x/net` (go-module) under
`**/node_modules/@bufbuild/buf-*/**`. **Expires 2027-01-19.** Reason: buf is
a dev/CI tool, never shipped. Nothing else may be ignored; `VULN_FAIL_ON`
stays `high`.

**Why:** "0 vulnerabilities" from `npm ci` does not mean grype will pass.
Bundled native binaries are scanned too. The user accepts ignores only
narrowly scoped, with a reason and an expiry.

**How to apply:** on or after 2027-01-19, or when bumping `@bufbuild/buf`,
check whether a buf release has x/net >= 0.62.0; if so, bump and delete the
rule. Any new ignore needs the user's approval in the PR. See
[[ci-sandbox-limits]].
