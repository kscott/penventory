# alias_to is idempotent when two rows share the same typo in one commit

**Status:** Accepted

**Context:**
`aliases` has a `unique().on(t.alias, t.aliasable_type)` constraint — correct, since an alias
string should only ever mean one canonical entity. `applyDecision`'s `alias_to` branch inserted
unconditionally whenever a field's decision was `alias_to`. Two rows in the same import batch
sharing the exact same typo (a real, plausible case — the same brand misspelling can easily appear
on more than one row of a real export) and both decided `alias_to` the same target hit that unique
constraint on the second insert. Confirmed with a fixture (`two-rows-same-brand-typo.csv`, two
rows both `Brand=Wavecrst`) and a spike test before fixing: the second `applyDecision` call threw
a raw `SqliteError: UNIQUE constraint failed: aliases.alias, aliases.aliasable_type` from inside
the commit transaction, rolling back *both* rows — including the first one, whose alias insert had
already succeeded moments earlier in the same transaction.

**Decision:**
`applyDecision`'s `alias_to` branch checks for an existing `(alias, aliasable_type)` row first:
- If none exists, insert as before.
- If one exists and points at the *same* `aliasable_id` the current decision names, treat it as
  already satisfied — return the target id without inserting again. Two rows deciding the same
  typo means the same target are in agreement, not a conflict.
- If one exists and points at a *different* `aliasable_id`, that's a genuine conflict (two
  decisions disagreeing on what the same typo means within one commit) — refuse with a clear
  `CommitRefusedError` naming both ids, instead of letting a raw constraint violation surface.

**Consequences:**
- A real, previously-crashing scenario now commits cleanly, producing exactly one alias row shared
  by both pens.
- The conflict case still refuses (correctly — there's no sane way to silently pick a winner
  between two different targets), but with an application-level error instead of a raw SQLite
  exception bubbling out of a transaction.
- Found via the same "consider what else could cause data import problems" sweep as
  [[docs/adr/2026-07-10-re-flags-update-the-original-row]] and
  [[docs/adr/2026-07-10-flag-signals-are-not-mutually-exclusive]] — proven with a reproducing spike
  test before writing the fix, not inferred from reading the code alone.
