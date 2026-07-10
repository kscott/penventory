# Every uncovered line gets read and explained — 100% is the real bar, 90% is just the CI gate

**Status:** Accepted

**Context:**
During a post-merge completeness review of Phase 1 step 6 (issue #14), coverage sat at ~91–92%
branches — comfortably above the enforced 90% CI threshold
([[docs/adr/2026-07-08-coverage-threshold-90-percent]]). Ken pushed back on treating that as
"done": *"The threshold may be 90%, but my expectation is 100% unless that is a 100% valid,
verifiable reason for it."*

Went through every uncovered line individually — reading the actual code, not just accepting the
percentage — across `fpc-import.ts`, `nib-parser.ts`, `decision-resolution.ts`, and `schema.ts`.
Of roughly a dozen gaps, most were real test-coverage oversights (an FK-reference closure
(`importAttemptId`) never added to the existing coverage list; the pens-side `Archived` mapping
and inks-side `Maker` column never exercised end-to-end despite being designed for since the
start; a `decidedField ?? null` fallback path never hit). One test's own inline comment was
factually wrong — it claimed to demonstrate near-miss typo detection ("sF"), but
`damerau-levenshtein("sf","f")` is 0.5, below the 0.7 threshold; the feature it claimed to prove
had never actually been exercised by any test.

**Two gaps turned out to be live bugs, not just missing tests:**
- `loadExistingPenKeys`/`loadExistingInkKeys` built composite keys from a smaller field set than
  the batch-side keys they were compared against (existing pens silently dropped Model/Trim
  Color; existing inks dropped Line entirely) — the two strings could never look similar to each
  other for a genuinely identical row. "Flags a duplicate against what's already in the
  database," named explicitly in `phase1-plan.md` step 6, had zero real function despite reading
  as implemented.
- `commitImportAttempt` force-unwrapped (`!`) a `SELECT` result for an unrecognized nib
  `base_size`/`purity` that could genuinely be `undefined` — a real crash on real data, masked
  because no fixture had ever fed it a base size outside the seeded set.

**Decision:**
90% stays the enforced CI gate (a build shouldn't fail from a single legitimately-hard-to-reach
branch), but the actual working standard for this project is 100% — every uncovered line in a
coverage report gets individually read and either (a) covered with a real test, or (b) left
uncovered only with a written, specific reason visible in the code or the commit, never silently
accepted because the aggregate percentage already cleared the gate.

**Consequences:**
- Coverage gaps are treated as a *question* ("why isn't this covered?"), not a number to satisfy.
  The answer is sometimes "this is genuinely unreachable defensive code, tested indirectly" — that
  is a valid, verifiable reason and gets documented as such, not silently ignored either.
- This is precisely how the two live bugs above were found — neither would have surfaced from
  "tests pass, coverage is above threshold" alone.
- Applies retroactively whenever a session works in a file with less-than-100% coverage: don't
  just add the one test needed for the change at hand, look at what else in that file's report is
  uncovered and ask why.
