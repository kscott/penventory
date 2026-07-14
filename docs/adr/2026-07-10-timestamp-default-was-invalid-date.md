# Every default-populated timestamp was silently an Invalid Date

**Status:** Accepted

**Context:**
While closing out the pens field-by-field completeness review, wrote a test asserting
`pen.updated_at.getTime()` against a captured `before` timestamp — the first test in the project
to actually call `.getTime()` on a default-populated timestamp rather than just
`.not.toBeNull()`. It failed with `NaN`. Checked directly rather than assumed:

```
raw sqlite value: { updated_at: '2026-07-10 21:32:54' }
pen.updated_at: Invalid Date
```

`schema.ts`'s `timestamps` helper (used by nearly every table — `brands`, `models`,
`pen_materials`, `finishes`, `filling_systems`, `nib_shapes`, `vendors`, `lines`, `pens`, `inks`,
`nibs`, plus `import_runs.run_at` and `import_attempts.created_at` separately) defaulted these
columns to `sql\`(CURRENT_TIMESTAMP)\``. That SQLite function returns its human-readable TEXT
format (`'YYYY-MM-DD HH:MM:SS'`), but every one of these columns is declared
`integer(..., { mode: 'timestamp' })` — Drizzle's SQLite integer-timestamp mode expects a unix
epoch integer and multiplies it by 1000 to build a JS `Date`. Feeding it a TEXT string instead
produces `NaN`, silently, on every read.

This has been present since the `timestamps` helper was introduced in Phase 1 step 2 (the
controlled-list schema). It was invisible because:
- Any timestamp explicitly set by application code (e.g. `created_at: new Date(rowData.createdAt)`
  in the FPC import path) bypasses the default entirely and stores correctly — Drizzle handles
  the JS-Date-to-epoch conversion for explicit values.
- No test before this one ever called a Date-typed method on a *default*-populated timestamp —
  only existence/null checks, which pass regardless of whether the underlying value round-trips
  correctly.

**Decision:**
Replace `sql\`(CURRENT_TIMESTAMP)\`` with `sql\`(unixepoch())\`` everywhere it's used as a
default for an `integer(..., { mode: 'timestamp' })` column. `unixepoch()` (SQLite 3.38+;
confirmed present in the bundled `better-sqlite3` version, 3.53.2) returns the correct unix epoch
integer directly. Second-granularity, not millisecond — tests comparing a default-populated
timestamp against a JS `Date.now()` capture need up to 1s of slack, not exact ordering.

**Consequences:**
- Every row ever created in a real (non-test, since tests always use fresh temp databases)
  environment would have had a genuinely broken `updated_at`/`created_at` wherever the default
  fired — but nothing has been deployed yet (Phase 1 isn't done), so there's no real data to
  migrate or repair.
- New migration recreates every affected table (SQLite can't `ALTER COLUMN` a default expression)
  — same mechanism as every other schema change this phase, no data loss on a fresh dev DB.
- Reinforces the coverage-to-100% standard directly: this was found by a test that exercised a
  value meaningfully instead of just checking it wasn't null — see
  [[docs/adr/2026-07-10-chase-coverage-gaps-to-100-percent]]. A `.not.toBeNull()` check on an
  `Invalid Date` object passes; only actually using the value (`.getTime()`, a comparison, a real
  read) exposes the bug.
