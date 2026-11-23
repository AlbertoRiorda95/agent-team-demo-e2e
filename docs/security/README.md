The security agent writes its assessments here: `docs/security/<yyyy-mm-dd>-assessment.md`.
The folder is in `.gitignore`: reports contain working proofs of vulnerabilities.
Remove that line only if the repository is private and you want to keep them.

## Assessment log
Only the date, the commit and the finding counts are listed here: no proofs.
The owning roles track the fixes as separate tasks.

| Date | Issue | Commit | Target | Findings | To re-test |
|---|---|---|---|---|---|
| 2026-11-23 | #78 | 39a5bd2 | local docker compose (foundations milestone) | 0 critical, 0 high, 4 medium, 5 low, 1 suspected | k8s RBAC and Secrets, viz-web history and SSE, control-web scale and config, read-only DB user, NATS handlers: not built yet |
