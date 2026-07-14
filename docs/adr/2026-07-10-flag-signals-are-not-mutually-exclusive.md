# A row's duplicate/unparseable-nib/needs-confirmation signals are independent, not exclusive

**Status:** Accepted

**Context:**
Reviewing multi-field interactions surfaced that `determineFlag` (`fpc-import.ts`) was an
if/else-if chain: check duplicate match, else check unparseable nib, else check flagged fields —
return as soon as the first one matched. Two real, reachable combinations expose the bug:

1. **Duplicate + ambiguous field.** Composite-key duplicate detection runs on raw text, entirely
   independent of `resolveOrFlag`. A row can be a near-duplicate of an existing pen on
   Model/Color/Material/Trim while its Brand is *also* a typo needing its own decision. Before
   the fix, `determineFlag` returned `possible_duplicate` and the brand ambiguity was never
   written to `candidate_info` at all — not hidden, gone. A reviewer had no way to even see it,
   let alone decide it. Choosing `import` on the duplicate call led straight to a commit-time
   `CommitRefusedError` ("still ambiguous, no recorded decision") that pointed at nothing the
   reviewer had been shown.
2. **Duplicate + unparseable nib.** `penCompositeKey` deliberately excludes `Nib` (an
   already-committed pen has no raw nib text to reconstruct it from — see the comment on
   `penCompositeKey`), so a row can be an exact duplicate on every other field while its `Nib`
   text is independently malformed (the confirmed real `"sF"` case). Before the fix,
   `resolveRowForCommit`'s nib-reresolution branch was gated on `item.flag_type ===
   'unparseable_nib'` — a row flagged `possible_duplicate` never entered it. Choosing `import`
   silently committed the pen with **zero nibs created, no error, no re-flag** — worse than the
   first case, because nothing indicated anything had gone wrong. Confirmed with a spike test
   before fixing: `commitImportAttempt` returned `{ committed: true, pensCreated: 1, nibsCreated:
   0 }`.

Both gaps trace to the same root cause: flag_type is a single enum column, but the underlying
signals it's meant to summarize are not mutually exclusive events.

**Decision:**
`determineFlag` now computes all three signals — duplicate matches, unparseable-nib reason,
flagged controlled-list fields (including nib value flags) — unconditionally, and folds whichever
ones actually fired into one `candidate_info` object (`FlagCandidateInfo` in
`decision-resolution.ts`: `{ matches?, unparseableNibReason?, fields, nibValueFlags }`).
`flag_type` still picks one "headline" reason, in priority order (`possible_duplicate` >
`unparseable_nib` > `needs_confirmation`) — driven by how consequential getting it wrong is, most
severe first — for whatever a review UI shows as the primary badge, but nothing is silently
dropped just because it wasn't the headline.

Two downstream call sites had to stop keying off `flag_type` and start keying off the row's actual
content:
- `isItemFullyDecided`: a row-level decision is required whenever `flag_type !== null &&
  flag_type !== 'needs_confirmation'` (unchanged in spirit), and *separately*, every field named
  in `candidate_info.fields`/`nibValueFlags` needs its own `field_decisions` entry — checked
  unconditionally now, not only when `flag_type === 'needs_confirmation'`.
- `resolveRowForCommit`'s nib-reresolution branch: gated on `rowData.nib.kind === 'unparseable'`
  directly, not `item.flag_type === 'unparseable_nib'`. This is what actually closes gap 2 above —
  a duplicate-flagged row with a genuinely broken `Nib` now re-parses it at commit exactly like an
  `unparseable_nib`-flagged row would, and refuses (rather than silently proceeding) if it's still
  broken.

`applyDecision`/`findOrCreateExactMatchWithDecision` needed no changes — they already read
`item.field_decisions` directly, never `item.flag_type`, so once `candidate_info.fields` actually
contained the data, per-field resolution at commit already worked correctly.

**Consequences:**
- A row that's both a duplicate and has an ambiguous field now shows both in the review UI's data
  (once Phase 1.1 builds it) and requires both decisions before commit will accept it.
- A row that's both a duplicate and has a malformed `Nib` now refuses loudly on `import` unless
  the nib is corrected first (same correction contract as a standalone `unparseable_nib` —
  edit `row_data.raw.Nib`, decide `import` again) — never silently drops the nib.
- Test fixtures/pattern: `seedExistingPen` helper in `fpc-import.integration.test.ts` builds a
  fully-resolved existing catalog pen so a test can force a genuine duplicate match alongside a
  second signal on the incoming row — reused across both new regression tests.
- Found via the same discipline as the rest of this review: don't accept "the individual pieces
  are tested" as proof the *combination* works. A spike test proving the exact failure mode (empty
  `candidate_info.fields`; `commitImportAttempt` returning `nibsCreated: 0` with no error) ran
  before any fix code was written, per
  [[docs/adr/2026-07-10-chase-coverage-gaps-to-100-percent]]'s same standard applied to behavior,
  not just line coverage.
