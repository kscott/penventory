# `nibs.purity`/`base_size`/`point_size` are real lookup tables, not TypeScript enums

**Status:** Accepted (amends [[2026-07-08-simple-fields-skip-controlled-list-machinery]])

**Context:**
Caught mid-Phase-1-step-4 by Ken asking what the actual workflow is when a value is missing. The
original design (plain `text(col, { enum: [...] })` columns) was chosen specifically to avoid
fuzzy/alias treatment — real data confirms "FM"/"MF"/"F/M" are three genuinely distinct point
sizes, not typos, and a fuzzy matcher would mis-flag them. That reasoning is correct and
unchanged. But it doesn't require the valid-values list to live in application code: verified
empirically that Drizzle's SQLite `enum` option emits a plain `text` column with no `CHECK`
constraint — adding a value to the array produces zero migration diff, confirming it's
TypeScript-only, not enforced by the database at all. Consequence Ken caught: since
`purity`/`base_size`/`point_size` are collector/manufacturer vocabularies he doesn't fully
control (a rare karat, an unusual nib housing size), a genuinely missing value could only ever be
added by editing `schema.ts`, building, and deploying — real friction blocking an in-progress
task, unlike the FK-based controlled lists, where adding a new canonical row is already just a
data operation.

**Decision:**
Three new tables, same unscoped shape as the controlled lists (`id`, unique `name`, timestamps)
and seeded with the known values (`NIB_PURITY_SEED`/`NIB_BASE_SIZE_SEED`/`NIB_POINT_SIZE_SEED` in
`schema.ts`) by the migration's own hand-added `INSERT` statements — but deliberately **not**
added to `ALIASABLE_TYPES`, so `resolveOrFlag`'s fuzzy/alias machinery never touches them.
Resolution is exact-match-only: found, or flagged for an explicit "add this value" decision —
never fuzzy-suggested, never silently created.

**Consequences:**
- Separates two questions that were previously bundled into one: "should this field tolerate
  typo-fuzzing" (no, confirmed by real data) is independent of "does extending the valid set
  require a deploy" (no, now that it's a table).
- `size_category`/`condition`/`ownership_state`/ink `type`/`color_override_source`/the shared
  `high`/`medium`/`low` levels stay plain TypeScript enums — they're the app's own
  workflow/structural states, not external vocabulary Ken is reacting to, so the same friction
  doesn't apply.
- What "live entry" looks like once it exists: `phase3-plan.md` step 1 already specified a
  Brand/Line picker with an "Add new..." escape hatch calling `resolveOrFlag` inline — same
  mechanism, applied live/synchronously rather than batched through an import's review report.
  Extended `phase3-plan.md` step 3 (Nib CRUD) to say so explicitly. Until Nib CRUD ships, there
  is genuinely no live-entry path — accepted as a real, known gap of the phased build-out rather
  than patched with an interim CLI.
