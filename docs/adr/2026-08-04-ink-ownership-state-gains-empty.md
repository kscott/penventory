# Ink `ownership_state` gains a fourth value: `empty`

**Status:** Accepted

**Context:**
Surfaced while working through Phase 1.1 step 3a's possible_duplicate review UI, specifically the
Ohio River case (two real bottles of the same ink — one gifted away and archived, one bought
fresh later). Confirming how a genuine rebuy should be modeled (see
`docs/adr/2026-08-04-ink-rebuy-purchases-deferred.md`) raised a related, previously-unresolved
question: what state does an ink sit in *between* running dry and being rebought?

`vision.md` had already touched this once and punted: "The same 'gone but preserved, hidden
unless asked for' rule would likely apply to a fully emptied ink bottle too, though Ken's
skeptical that actually happens in practice ('it may be a myth')." Revisited directly — it isn't a
myth; it's a real, distinct state from `retired`. `retired` means "still has ink, choosing not to
reach for it." `empty` means "physically can't — there's none left."

**Decision:**
`OWNERSHIP_STATES` (schema.ts) becomes `['active', 'retired', 'empty', 'rehomed']` — one shared
enum across `pens` and `inks`, not split into two per-entity enums, even though `empty` only ever
makes sense for an ink. Ken's explicit call: simplicity of one enum over the theoretical
correctness of disallowing a pen from ever being set to `empty` (nothing will ever do that in
practice).

Rebuying an emptied ink moves it back to `active` — `empty` is current status, not a permanent
record of ever having run dry. That history (when it ran out, when it was rebought) belongs in the
purchase log once it exists (Phase 4), not in `ownership_state` itself.

This is a pure TypeScript-level schema widening, not a real migration: Drizzle's SQLite
`text(..., { enum: [...] })` was already confirmed (during the nib-value-lookup-tables review) to
emit a plain `text` column with no `CHECK` constraint — `db:check-drift` confirms no SQL actually
changed. Nothing currently *sets* `empty` — there's no signal for it until Phase 3's manual edit
UI or Phase 4's inkings/usage ledger exists.

**Consequences:**
- `fpc-import.ts` doesn't change — FPC's `Archived` boolean only ever maps to `active`/`rehomed`
  at import time, same as before.
- A pen could technically be set to `empty` (the enum doesn't forbid it) even though nothing in
  the app will ever do that — an accepted, deliberate looseness, not an oversight.
- `docs/vision.md`'s Ownership state section and `docs/PRD.md` §5.5 updated to describe `empty`
  as settled, not speculative.
