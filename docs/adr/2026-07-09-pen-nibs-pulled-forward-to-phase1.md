# `pen_nibs` pulled forward from Phase 4 into Phase 1 step 5

**Status:** Accepted

**Context:**
Caught scoping step 5: `phase1-plan.md` step 6 already said "every pen row creates a linked
`nibs` row too, via `pen_nibs`," but `pen_nibs` itself was scheduled for `phase4-plan.md` step 1
— a real contradiction, since step 6 can't do what it says without a table that wouldn't exist
for three more phases.

**Decision:**
`pen_nibs` schema (`id`, `pen_id` → pens, `nib_id` → nibs, `installed_on`, `removed_on` nullable,
`notes`) moves to Phase 1 step 5, alongside the raw repository create/read for pens/inks/nibs
already needed there.

**Consequences:**
- Unlike `used`/`swatched`/`purchases` (genuinely deferred: nothing to compute or track until
  their owning feature exists), `pen_nibs` has a real consumer now — the FPC import needs to link
  an imported pen to the `nibs` row parsed from its stock nib, not leave it an orphaned catalog
  entry.
- `phase4-plan.md` step 1 is narrowed to what's actually left once the schema already exists: the
  assign/remove service/UI and "current nib" query, plus the nib-swap business logic (close the
  stock nib's row, open a new one) — same design as
  [[2026-07-08-nibs-first-class-tracked-as-history]], just built on schema that already exists by
  the time Phase 4 starts.
