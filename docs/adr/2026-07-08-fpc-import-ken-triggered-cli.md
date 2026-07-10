# FPC import is a Ken-triggered CLI with dry-run review

**Status:** Superseded by [[2026-07-09-no-cli-at-all-for-import]]

**Context:**
An earlier draft of `phase1-plan.md` had the real import as a step Claude executes while working
through Phase 1. Ken's call: he provides the export file, on his own schedule, and controls
whether/what gets committed.

**Decision:**
A dry-run pass parses + normalizes + runs duplicate detection and writes a review report;
nothing writes to the database until Ken's reviewed every flagged row and re-runs with
`--commit`, which takes an automatic pre-write backup.

**Consequences:**
- Populating real data is explicitly outside each phase's CI-gated definition of done.
- This CLI-based design was itself rejected two days later once Ken traced through how it would
  actually run against the deployed instance — see
  [[2026-07-09-no-shell-ssh-operational-rule]] and [[2026-07-09-no-cli-at-all-for-import]]. Kept
  here as the record of the design that came before, not the current answer.
