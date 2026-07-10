# Pen duplicate-detection identity key: audited, kept as-is

**Status:** Accepted

**Context:**
Ken asked directly whether `Brand|Model|Color|Material|Trim Color` (`penCompositeKey` in
`fpc-import.ts`) is actually the right identity key for pen duplicate detection — not just whether
the flagging mechanism is tested, but whether the key itself over-matches (flags two genuinely
different pens as duplicates) or under-matches (misses a real duplicate), and how an
existing-catalog match and an in-batch match combine when both fire for the same row.

**Findings:**

1. **`Nib` is deliberately excluded**, and stays excluded. An already-committed pen has no raw
   nib text retained (it's parsed into structured `nibs` columns, not kept as a string — see the
   comment on `penCompositeKey`), so there's nothing to reconstruct a nib-inclusive key from for
   the existing-catalog side; the two sides must use the same field set or they can never match
   each other at all (this was a real, confirmed bug earlier in this branch — the original
   existing-side formula silently dropped Model and Trim Color too). Consequence: two pens that
   are the exact same Brand/Model/Color/Material/Trim but genuinely have different nib grinds (a
   real collector case — buying the same pen twice with an EF and a B, say) will be flagged as a
   possible duplicate. This is the *safe* direction to be wrong in: the row surfaces for review,
   Ken can confidently choose "import anyway," and nothing is silently merged or dropped. The
   alternative (somehow keying on Nib) isn't reachable without retaining raw nib text
   indefinitely for every committed pen, which nothing else in the schema does.

2. **`Filling System` is not part of the key at all** — never was, and this wasn't flagged
   anywhere before this audit. In practice a given Brand+Model's filling system is fixed (it's a
   manufacturing property of the pen line, not something that varies pen-to-pen the way Color or
   Trim Color legitimately does), so omitting it doesn't meaningfully change matching behavior for
   real data. Same safe-direction argument as Nib applies if it ever did vary: the other four
   fields matching still triggers a review flag, never a silent merge.

3. **Existing-catalog and in-batch matches are independent and both reported**, never one
   overwriting the other. `findDuplicateMatches` returns `[...existing matches, ...batch
   matches].sort(by similarity)` — a single row can appear in `candidate_info.matches` with two
   entries, `matchType: 'existing'` and `matchType: 'batch'`, if it matches both a
   previously-committed pen and an earlier row in the same import. Confirmed with a test (three
   effectively-identical pens: one already in the catalog, two in the same import batch) — the
   second batch row's `matches` array contains both entries, sorted by similarity, nothing
   dropped.

4. **Fixed as part of this audit: a `matchType: 'batch'` candidate's `id` was the row's raw
   position in the parsed CSV array (`0`, `1`, `2`, …), not anything a reviewer could act on.**
   `DuplicateCandidate`/`DuplicateMatch`'s `id` field means the real database id for `existing`
   matches (directly usable in a `merge_into` decision) but had no equivalent meaning for `batch`
   matches — a bare array index doesn't correspond to anything visible in a review UI. Changed to
   the row's `sourceLine` (already computed and stored per row) — a reviewer can now see "this
   matches line 6 of the CSV" instead of an opaque number. `DuplicateCandidate`'s type comment now
   documents this dual meaning explicitly.

5. **Per-field whitespace isn't independently normalized** — `duplicate-detection.ts`'s
   `normalize()` trims/lowercases the *whole joined composite key string*, not each field before
   joining. Stray internal whitespace in one field (a plausible CSV artifact) isn't cleaned up
   before comparison. Accepted as a minor, low-impact gap rather than fixed here: the fuzzy
   threshold (0.7 similarity, `similarity.ts`) has enough slack that a few whitespace characters
   out of a ~40-character composite key essentially never push a real duplicate below the
   near-dup threshold in practice, and fixing it would mean per-field normalization threaded
   through `penCompositeKey`/`inkCompositeKey`/`loadExistingPenKeys`/`loadExistingInkKeys`
   consistently — a real but separable change, not one this audit is blocking on.

**Decision:**
Keep the composite key as `Brand|Model|Color|Material|Trim Color` for pens. The exclusions (Nib,
Filling System) are both safe in the direction they're wrong in — they can only cause extra review
prompts for genuinely distinct pens, never a silent merge of two different ones or a missed
duplicate that goes on to corrupt the catalog. Fix the batch-match `id` semantics (done, see
finding 4) since that's the one place the audit found something *actually* wrong, not just a
documented tradeoff.

**Consequences:**
- No schema or key-shape change. This ADR exists so the "is this the right key" question doesn't
  need re-deriving in a future session — it was asked directly and answered with evidence, not
  assumed.
- `docs/adr/2026-07-10-flag-signals-are-not-mutually-exclusive.md` and
  `docs/adr/2026-07-10-re-flags-update-the-original-row.md` cover the two duplicate-detection
  *mechanism* bugs found earlier in this same review pass (signal masking, and the
  unparseable_row-correction path skipping duplicate detection entirely) — this ADR is about the
  key's *shape*, not those.
