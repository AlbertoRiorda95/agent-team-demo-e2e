---
name: buf-binary-grype
description: The CI vulnerabilities job (grype on syft SBOM) flags Go modules inside the @bufbuild/buf npm platform binary; npm audit does not see them
metadata:
  type: project
---

`sbom-licenses` runs `npm ci --ignore-scripts` and `syft dir:.`, so the Go
binary in `node_modules/@bufbuild/buf-linux-x64/bin/buf` is in the SBOM.
On 2026-11-20 (PR #54), buf 1.75.0 (the newest) shipped `golang.org/x/net
v0.61.0` (GO-2026-6860, High) and go1.27.3, so `vulnerabilities` went red.
No buf version on npm fixed it. The user was asked to choose: wait for a buf
release, approve a scoped grype ignore, or have designer change how buf is
obtained.

**Why:** "0 vulnerabilities" from `npm ci` does not mean grype will pass.
Bundled native binaries are scanned too.

**How to apply:** when bumping `@bufbuild/buf` (or adding any npm package
that ships a Go/Rust binary), check the embedded module versions against
grype findings. Check whether PR #54's decision was made before acting. See
[[ci-sandbox-limits]].
