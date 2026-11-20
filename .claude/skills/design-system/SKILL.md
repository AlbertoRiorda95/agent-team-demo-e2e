---
name: design-system
description: The project's tokens, components and visual rules. Use it for every interface spec or page.
---

# Project design system

Dark "mission control" theme for `services/viz-web` and `services/control-web`.
Data first, dense but calm, no decoration. Keep this file short: designer and
frontend preload it on every start.

## Where the tokens live

`packages/ui-tokens/tokens.css`, shared by both web apps. Never hand-written
color, spacing or typography values. The 3D scene (Three.js) reads the same
tokens at start-up (`getComputedStyle`), never its own hex values.

## Main tokens

| Token | Use |
|---|---|
| `--color-bg`, `--color-surface`, `--color-border` | neutral greys, darkest to lightest |
| `--color-fg`, `--color-fg-muted` | text, secondary text |
| `--color-accent` | cyan: primary actions, links, focus, the ballistic segment |
| `--color-burn` | amber: the burn phase (segment, timeline range, legend) |
| `--color-danger`, `--color-warning`, `--color-ok` | error, degraded, ok states (always with a label or icon, never color alone) |
| `--space-1` ... `--space-6` | spacing, scale 4/8/12/16/24/32 px |
| `--font-body` | Inter, for UI text |
| `--font-mono` | JetBrains Mono, for numbers, readouts, tables of samples |

## Base components

Button (primary, secondary, danger), text and number field with unit suffix,
select, toggle (Live/History), table, status badge (ok, degraded, down,
unknown), confirmation dialog, toast, timeline (play/pause, rewind, scrubber,
speed). Each has the states default, hover, visible focus, disabled, error.

## Rules

- Contrast at least 4.5:1 for text and 3:1 for UI parts on the dark
  backgrounds (WCAG 2.2 AA).
- Numbers in `--font-mono` with tabular figures, units always shown (m, s, N, kg, m/s).
- Desktop first: designed for 1280 px, usable down to 768 px.
- Touch targets of at least 44 px; every control reachable by keyboard.
- Every page has empty, loading and error states; the live view also has
  "disconnected".
- The 3D view always has a text alternative: the readout and the sample table.
