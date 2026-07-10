# Fuzzy-match algorithm: Damerau-Levenshtein via the `damerau-levenshtein` npm package

**Status:** Accepted

**Context:**
`resolveOrFlag` (see [[2026-07-08-duplicate-protection-shared-resolveorflag]]) and the import's
duplicate detection both need a deterministic, pure similarity score between two short
proper-noun strings — no live external state, one implementation reused in both places.

**Decision:**
Damerau-Levenshtein, not plain Levenshtein — plain Levenshtein counts an adjacent-letter swap as
two edits; Damerau-Levenshtein counts it as one, which directly matters since the concrete case
already in the plan ("Piolt" flagged against "Pilot") is exactly a transposition, not a
substitution. Verified live against the npm registry before deciding: `damerau-levenshtein`
v1.0.8, zero runtime dependencies, ~145M downloads/month despite no publish since January 2022 —
read as "small, correct, algorithm-complete, embedded deep in the ecosystem," not "abandoned,"
given the download volume relative to its size.

**Consequences:**
Rejected alternatives: bigram/token-overlap scoring (doesn't model single-character typos as
directly), phonetic matching like Soundex/Metaphone (solves sounds-alike, not spelled-alike —
wrong problem), embedding/model-based similarity (breaks
[[2026-07-08-no-live-external-state-in-tests]], non-deterministic, overkill for short strings).
