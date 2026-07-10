# Every ambiguous field on a row gets its own decision, not just the first

**Status:** Accepted

**Context:**
During the step 6 completeness review, Ken asked directly: "I'm getting the feeling that if
there are multiple fields that have match problems, only the first one encountered is worked.
Is this true?" It was — confirmed with a concrete example: a row with a typo on `Brand` *and* a
typo on `Material` both get collected correctly into `candidate_info.fields` at parse time, but
`decidedField` (a single string) named only the first one found, in a fixed priority order. At
commit, deciding the named field (e.g. `Brand` via `merge_into`) let that field resolve, but
`Material` — genuinely ambiguous, never decided — fell through to `settleField`, which found it
still `flagged` and threw, refusing the *entire* commit. There was no way to decide the second
field at all: it was never its own reviewable thing, just a second key inside the same row's
`candidate_info.fields` that nothing let you act on. Re-running the import wouldn't help either —
the same two problems would recur.

**Decision:**
Replace the single `decision`/`decision_target_id` columns' role for `needs_confirmation` rows
with a `field_decisions` JSON column: `Record<string, { decision, decisionTargetId }>`, one entry
per ambiguous field. Commit requires every field named in `candidate_info.fields` *and* every
entry in `candidate_info.nibValueFlags` to have its own entry before the row is considered
decided — not just one. `applyDecision` looks up `item.field_decisions[field]` directly instead
of comparing against a single `decidedField`.

`decision`/`decision_target_id` stay on the table, narrowed to genuinely row-level cases where
there's only ever one judgment call: `possible_duplicate` (import-anyway or skip — no per-field
concept applies to "is this the same real item"), and the row-level `skip` that unconditionally
discards a row regardless of how many fields are ambiguous. `unparseable_nib`/`unparseable_row`
also use the row-level decision, but for a different reason — see
[[docs/adr/2026-07-10-unparseable-rows-are-correctable]].

nib_base_size/nib_purity (exact-match-only, never fuzzy-matched) get the same treatment for
consistency: adding a new value now requires its own `field_decisions` entry
(`findOrCreateExactMatchWithDecision`) rather than being created unconditionally the moment it's
missing — nothing gets written to the catalog without an explicit decision behind it, the same
rule already applied to every other field.

**Consequences:**
- A row with N genuinely ambiguous fields needs N decisions, all reviewable and resolvable in one
  pass, not just the first.
- `decision-resolution.integration.test.ts` has an explicit describe block proving two
  independently-flagged fields on one row (`Brand` + `Material`) both resolve correctly in a
  single commit — the direct fix for the gap Ken found — plus the contrasting case (only one
  decided, the other still refuses rather than being silently created).
- Extraction of `applyDecision`/`settleField` into `decision-resolution.ts` (already done for the
  contains-blocks-import rule) made this change contained to one file plus the schema, not a
  rewrite of the whole commit pipeline.
