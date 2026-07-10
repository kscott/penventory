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

**Addendum, 2026-07-10 (identity-key redesign):** Ken asked directly why the terminal summary
showed only one uncovered *line* while Statements/Branches were both meaningfully below 100% —
the terminal's "Uncovered Line #s" column only lists lines with *zero* execution; a line where one
arm of an `if`/ternary/`&&` fires but the other never does still counts as "line covered," so
partial-branch gaps hide behind it entirely. Regenerating the HTML report (`reporter: ['text',
'html']`, already configured) and grepping for `cbranch-no`/`missing-if-branch` surfaced the exact
locations. Of 7 branch gaps found this way: 5 were genuine missing tests (closed — see
[[docs/adr/2026-07-10-identity-key-is-resolved-not-raw-text]]'s test additions), but **2 were
actually structurally unreachable dead code introduced by the redesign itself** — a three-way
ternary (`resolution.model ? … : outcome === 'new' ? … : null`) where the final `: null` arm could
never execute, because the function's own guard clause immediately above had already ruled out
every outcome except `'new'`. Simplified to a two-way ternary instead of writing a test for an
impossible case or leaving it as unexplained dead code. The lesson generalizes: when a coverage gap
resists every attempt to write a reaching test, check whether the branch is actually reachable
before concluding the test is just hard to write — TypeScript's type system doesn't track outcome
invariants across a guard clause and a later computation, so it can't catch this itself.
