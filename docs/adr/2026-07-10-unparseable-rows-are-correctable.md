# Unparseable rows and nibs are correctable, not just skippable

**Status:** Accepted

**Context:**
Two gaps surfaced together during the step 6 completeness review:

1. **Blank required fields were completely unhandled.** `resolveOrFlag('brand', '')` against any
   real catalog computes character-level similarity 0 and word-containment false (an empty
   string has no words) against every existing brand — no exact match, no alias, no fuzzy match,
   no contains match. Outcome: `'new'`, silently creating a real `brands` row literally named
   `""`. Checked directly (`damerau-levenshtein('', 'pilot')` → similarity 0) rather than assumed.
2. **`unparseable_nib` only ever supported `skip`.** A row with a malformed `Nib` value (e.g. the
   confirmed real `"sF"` case) could only be committed without a nib or discarded entirely — there
   was no way to fix the data and have it flow through normally, forcing a round-trip through the
   source CSV and a fresh import for a one-field typo.

Ken's response to both, stated as a general principle: "If data is in the import, user should
have every chance to correct it and get an import done."

**Decision:**
New `unparseable_row` flag type. For pens, a row is `unparseable_row` when any of **Brand, Model,
Color, Material, Filling System** is blank — the fields that map to a `NOT NULL` schema column
with no safe default. `Nib` is excluded (blank is a real, valid case — a pen body with no nib).
`Date Added` is also excluded: missing it falls back to the DB's own default (import time) rather
than blocking the row — losing the acquisition date is real but recoverable, unlike losing what
the pen even is. **`Trim Color` was originally in this set and was removed same-day**: Ken
confirmed a real case checking the actual export — "there are pens that have no trim - just a
nib" (unadorned/plain body, no plated hardware at all) — this isn't corrupt data, so
`trim_color_id` became nullable (same migration pass) instead of being required. A row failing
this (corrected) check writes a minimal
`UnparseableRowData` (raw CSV + which fields were missing) with no resolution attempted at all —
avoids wasted `resolveOrFlag` work on data that can't become a valid entry regardless.

Both `unparseable_row` and `unparseable_nib` get the same correction contract: the row-level
`decision: 'import'` means "the stored `row_data.raw` has been corrected — re-resolve it now,"
not "proceed blindly." `import_flagged_items.row_data` is already just JSON; Phase 1.1's review
UI (not built yet) editing it directly before choosing `import` is exactly what this is designed
for. At commit, `resolveRowForCommit` re-runs the real resolution logic (`resolvePenFields` for a
corrected row, `parseNibText` + the nib-material/shape/finish resolution for a corrected nib)
against whatever `row_data.raw` currently holds:
- Still broken (required field still blank / Nib still unparseable) → refuses again, with the
  specific missing fields or nib reason in the error.
- Fixed and clean → proceeds exactly like a fresh row would.
- Fixed but now ambiguous in some *new* way (e.g. the corrected brand name is itself a near-miss
  of an existing one) → re-flagged for another review round, same mechanism already used for
  model/line drift discovered only once brand context is known — not committed blind.
- Correcting `Nib` to blank is a legitimate outcome, not an error: it means "there's actually no
  nib for this pen," and commits the pen with none.

`decision` values other than `import`/`skip` (e.g. `merge_into`) make no sense for a whole-row or
whole-nib correction — no single candidate to merge into — and are explicitly refused rather than
silently misapplied.

Also bundled in, since it came up in the same conversation about correction and traceability:
`row_data.sourceLine` (1-indexed, header-aware) is now recorded for every parsed row, pens and
inks. Previously there was no way to trace a flagged row back to its line in the original CSV —
`entityType` told you which of the two files, nothing told you where in it.

Ink-side `unparseable_row` detection isn't wired into `parseCatalogImport` yet — pens-first, per
the review's own sequencing. The mechanism (schema, `resolveRowForCommit`'s dispatch) is generic;
`resolveRowForCommit` explicitly refuses an ink `unparseable_row` correction attempt with a clear
"not implemented yet" error rather than mishandling it silently, so the gap fails loudly if
something reaches it before that work lands.

**Consequences:**
- A human fixing a typo no longer needs to re-run the whole import — correct the one field in the
  review UI, choose `import`, done.
- `resolvePenFields` (parse) and the re-resolution path (commit) share the exact same resolution
  function — one implementation, not two that could drift apart.
- Fixture/test set: `blank-brand.csv`, `multi-field-typo.csv`, plus direct row_data mutation in
  tests (`correctRawField`) standing in for the not-yet-built review UI, matching the same
  fixture-and-integration-test pattern used throughout this phase.
