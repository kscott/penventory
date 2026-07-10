# `users`/`sessions` and `import_runs` added — both real gaps, not additions

**Status:** Accepted

**Context:**
Auth was named as a Stack-level decision (`project-plan.md`: "lightweight session-cookie, single
seeded user") but never actually scheduled into any phase or given a schema — caught by asking
"what's missing overall," not by cross-referencing `vision.md`, since it was never in `vision.md`
to begin with.

**Decision:**
`users`/`sessions` scheduled to Phase 2 step 1, before deploy plumbing — nothing should ship
reachable without the session gate already in place, even behind Tailscale's private-network
boundary. `import_runs` added as a lightweight audit log (`operation_type`, `mode`,
`report_summary` json, `run_at`) for the import/refresh operations, written at the end of every
dry-run/commit.

**Consequences:**
- Drizzle's own migration-tracking table is separate from both of these and needs no design —
  it's infrastructure `drizzle-kit`/`migrate()` manage automatically, not a table in the app's
  own Data Model.
- `users`/`sessions` later moved from Phase 2 to the new Phase 1.1 — see
  [[2026-07-09-import-gets-own-phase-1-1]].
