---
feature: demo-split
ready: yes
updated: 2026-11-20
owner: designer
---

# Operator notes in the control app

## Goal
The operator of the control-web app keeps a small journal of what was done to the pipeline (for example "scaled propagator to 0 to test the 429 window"), marks a service as "under maintenance" with a reason, and reads a daily digest of the journal. It is for the single operator of the demo. It works when: an entry written in the Journal panel is listed right away and survives a restart of the control-web server; a maintenance flag set on a service is shown in the services table; the digest shows the number of entries per day, and a click on a day opens that day's entries.

## Out of scope
- Any change to the pipeline services, to NATS subjects or to `proto/`: this feature lives only in control-web.
- Editing or deleting journal entries, authentication, several users.
- Making the maintenance flag block Start/Stop or alter the heartbeat state: it is a label only.
- Storage in PostgreSQL and durability across pod rescheduling in Kubernetes (the files are in the container's data folder).
- The 3D viewer (viz-web) and any launch form.

## User flows
1. **Part A, write and read the journal.** The operator opens the Journal panel, types a note and presses Save. The server stores it and the list shows it first. Empty or too long text: the form shows the error and nothing is stored. At start-up the server reads the entries back from its file.
2. **Part B, maintenance flag.** In the services table the operator turns on "Maintenance" for a service, writes a reason and saves; the row shows a "Maintenance" badge with the reason. Turning it off removes the badge. An unknown service name is rejected.
3. **Part C, digest.** The operator opens the Digest panel: one row per day with the entries count, newest day first. Clicking a day loads that day's entries with the endpoint of Part A and shows them under the row. A day with no entries does not appear; with no entries at all the panel shows its empty state.
Error cases: if the server is unreachable each panel shows an error with a Retry button and keeps the last data it had; a failed save keeps the text typed in the form.

## Screens and states
| Screen / component | States | Notes |
|---|---|---|
| Part A: Journal panel (Control page, below the Config form) | empty ("No entries yet"), loading, error (Retry), success (list: time UTC, text) | form: textarea (1–500 chars, counter), Save; Save disabled while the text is empty or over the limit or while saving |
| Part B: Maintenance column of the services table | off, on (badge + reason), saving, error (inline message) | a toggle and a reason input (0–120 chars, shown when on) per pipeline service row; PostgreSQL and NATS rows have no toggle |
| Part C: Digest panel (Control page, right of the Journal panel) | empty ("Nothing to summarize"), loading, error (Retry), success (rows: date, count) | a row is a button; its entries open below it (loading, error, list) using the Part A endpoint |

Responsive behavior: at the spec's viewports (mobile 390 px, desktop 1280 px) the Journal and Digest panels stack on mobile and sit side by side on desktop; the Maintenance column becomes a line under the service name on mobile.
Accessibility: every control has a visible label; the toggle is a real checkbox/switch reachable by keyboard; the day rows are buttons with `aria-expanded`; save results and errors are announced in an `aria-live="polite"` region.
Tokens: only from the design system; new tokens proposed here: none.

## Data and API
Entities and fields:
- JournalEntry: `id` (UUID v4), `created_at` (UTC ISO 8601, set by the server), `text` (string, 1–500 characters after trimming). Stored one JSON object per line in `data/journal.jsonl` of the control-web server.
- MaintenanceFlag: `service` (one of `api`, `propagator`, `store`, `ros2-publisher`), `on` (boolean), `reason` (string, 0–120 characters, empty when `on` is false), `updated_at` (UTC ISO 8601). Stored in `data/maintenance.json`.
- DigestDay: `date` (`YYYY-MM-DD`, UTC), `count` (integer >= 1).

Contract changes (applied by backend to `docs/api/`), all on the control-web server, JSON, errors as `application/problem+json`:
- Part A:
  - `POST /api/journal` body `{"text": string}` → 201 `{"id", "created_at", "text"}`; 422 listing the bad field (`/text`) when missing, empty after trimming, over 500 characters or not a string.
  - `GET /api/journal` optional query `date=YYYY-MM-DD` and `limit` (integer 1–200, default 50) → 200 `{"entries": [JournalEntry, ...]}` newest first; with `date`, only the entries of that UTC day; 422 for a bad `date` or `limit`.
- Part B:
  - `GET /api/maintenance` → 200 `{"flags": [MaintenanceFlag, ...]}` for the four services (a service never set is returned with `on` false).
  - `PUT /api/maintenance/{service}` body `{"on": boolean, "reason": string}` → 200 `MaintenanceFlag`; 404 for an unknown service; 422 for a wrong type, a reason over 120 characters, or a non-empty `reason` with `on` false.
- Part C:
  - `GET /api/journal/digest` optional query `days` (integer 1–90, default 30) → 200 `{"days": [{"date", "count"}, ...]}` newest first, counted from the same stored entries that Part A writes. The UI opens a day with `GET /api/journal?date=<date>` from Part A.
Breaking for existing clients: no (new endpoints only).

## Acceptance criteria
Part A:
- [ ] `POST /api/journal` with `{"text": "scaled propagator to 0"}` returns 201 with an `id` and a `created_at`, and `GET /api/journal` lists that entry first.
- [ ] `POST /api/journal` with an empty text, a 501-character text or a missing `text` returns 422 and stores nothing.
- [ ] After a restart of the server, the entries written before are still returned by `GET /api/journal`.
- [ ] In the Journal panel, Save is disabled for an empty text; after a successful save the new entry shows first and the form is cleared; after a failed save the text is kept and an error is announced.
Part B:
- [ ] `PUT /api/maintenance/store` with `{"on": true, "reason": "db upgrade"}` returns 200 and `GET /api/maintenance` shows `on: true` for `store` and `on: false` for the others.
- [ ] `PUT /api/maintenance/foo` returns 404; `{"on": false, "reason": "x"}` returns 422.
- [ ] The services table shows a "Maintenance" badge with the reason on a flagged row and none after the flag is turned off; the toggle works with the keyboard alone.
Part C:
- [ ] With 2 entries written on 2026-11-19 and 1 on 2026-11-20, `GET /api/journal/digest` returns `[{"date":"2026-11-20","count":1},{"date":"2026-11-19","count":2}]`.
- [ ] `days=0` or `days=91` returns 422.
- [ ] The Digest panel lists the days; clicking a day calls `GET /api/journal?date=<that day>` and shows exactly those entries; clicking again hides them.
- [ ] With no entries the panel shows "Nothing to summarize".

## Test seams
- API: `POST /api/journal`, `GET /api/journal`, integration test on the control-web server with a temporary data folder: catches validation, order, the `date` filter and persistence across a restart; misses the browser.
- API: `GET` and `PUT /api/maintenance`, same setup: catches the 404/422 rules and the default flags; misses the table rendering.
- API: `GET /api/journal/digest`, same setup with entries at fixed UTC times (clock injected): catches grouping by day and limits; misses the UI.
- UI: the Journal panel, the services table and the Digest panel on the Control page at 390 px and 1280 px, API mocked: catches states, keyboard use and labels; misses the real server.

## Reuse
- Server routes, validation and problem+json errors: the existing control-web server code (written here only for the new routes).
- IDs: Node's built-in `crypto.randomUUID`; the file store is written here (a few lines, no dependency).
- Panels and the table column: the existing Control page components and design-system tokens.
- Types and NATS: none needed, `@albertoriorda95/trajectory-proto` is not used by this feature.
- New third-party dependencies: none.

## Decisions
- 2026-11-20 — The journal and the flags live in files of the control-web server, not in PostgreSQL — the feature stays inside one service and needs no DB credentials.
- 2026-11-20 — Day boundaries are in UTC — one rule for the server, the digest and the tests.
- 2026-11-20 — The Digest panel opens a day through `GET /api/journal?date=` of Part A, instead of a new endpoint — one place that reads entries.
- 2026-11-20 — The maintenance flag is only a label — it must not change what Start/Stop or the heartbeat do.

## Open questions
- (none)
