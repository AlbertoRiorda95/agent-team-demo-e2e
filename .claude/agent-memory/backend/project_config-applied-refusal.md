---
name: config-applied-refusal
description: api treats a refused ConfigApplied (ok=false) as "use the defaults", while the propagator spec keeps the config in force; open gap seen in #89
metadata:
  type: project
---

The CONFIG stream keeps only the latest message per subject. The propagator (since #89) answers a refused `ConfigSet` (invalid or stale) with `ConfigApplied` ok = false carrying the config still in force. api's `config_snapshot` (services/api/src/trajectory_api/domain/launch.py) falls back to the defaults when the latest report has `ok` false, so after a refused set new launches use 60 s / 0.01 s until the next good set or a propagator restart. Reported in the #89 PR for designer/lead; not fixed (other service).

**Why:** spec propagation.md says ok=false keeps the config in force; launch-intake reads "the latest applied".
**How to apply:** when touching api config reads or the propagator answers, check whether this was resolved (api using the payload of an ok=false report, or a spec change) before relying on either behavior.
