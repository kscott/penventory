# Performance notes and end-reason are discrete boolean columns, not an enum or free text

**Status:** Accepted

**Context:**
`vision.md` explicitly calls these "checkboxes" (plural — a cleaning could involve *both* "ran
dry" and "ink issue" at once). The original schema had neither structured: a single `end_reason`
string (forces one choice, silently discards whichever reason didn't "win") and a single
`performance_notes` text blob (checkboxes existed only as a code comment, not real columns).

**Decision:**
Separate boolean columns per checkbox — `ended_ran_dry`, `ended_disliked`, `ended_needed_pen`,
`ended_ink_issue`; `flow_good`, `dry_time_good`, `feathering_observed`, `sheen_observed` — plus
one freeform text field alongside each group for anything the checkboxes don't capture.

**Consequences:**
- Reporting on any of this is a real column query, not unreliable string-matching against prose.
- `flow`/`dry_time` were later split back out into scaled values rather than booleans — see
  [[2026-07-08-inkings-nib-id-required-rating-flow-dry-time]].
- Full detail in `phase4-plan.md` step 4.
