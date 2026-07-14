# Duplicate identity is exact-match on resolved fields, not fuzzy raw text

**Status:** Accepted — supersedes the composite-key approach described in
[[2026-07-10-identity-matching-audit]]

**Context:**
Ken asked directly whether the app could process his entire real `collected_pens.csv`/
`collected_inks.csv` (his actual collection, not fixtures) and produce correct rows. Rather than
guess, built a temporary, non-committed sanity-check test (see the working-conventions note below)
that ran `parseCatalogImport` against the real files — read directly from
`~/Notes/personal/ink-collection/`, never copied into the repo — and reported what got flagged,
without ever calling `commitImportAttempt` (deciding on flagged items is real work on real data and
stays behind Phase 1.1's UI, per [[2026-07-09-no-cli-at-all-for-import]]; a parse-only diagnostic
doesn't cross that line).

Result: of 540 real rows, **265 (49%) flagged `possible_duplicate`** — and inspecting the matches
showed almost all of them were false positives. Dozens of distinct Esterbrook Estie pens (different
colorways — "Aqua," "Cobalt," "Maui," "Punch"…) were cross-flagged against each other; dozens of
distinct Birmingham Pen Company inks ("Bee Balm," "Blueberry," "Cistern"…) the same way. These are
genuinely different owned items, not typos or accidental double-entries.

Root cause: the composite key (`Brand|Model|Color|Material|Trim Color` for pens,
`Brand|Line|Name|Type` for inks) was compared as one fuzzy string via `similarity()`/
`isNearDuplicate()` — the same mechanism correctly calibrated for single controlled-list terms
(e.g. "Wavecrst" vs "Wavecrest"). Applied to a whole joined multi-field string, a long *shared*
prefix (Brand+Model+Material+Trim identical across every colorway of the same pen line — completely
normal in a real collection) dominated the edit-distance ratio. Even a completely different Color
still left similarity around 0.8–0.9, comfortably past the 0.7 threshold.

Ken's diagnosis, stated directly: *"It's almost like all the fields need to be resolved first,
before we think about matching full rows against each other or the database — that is the one
thing that nothing is considering now."*

**Decision:**
Duplicate matching is now two-stage, never a single fuzzy comparison:
1. **Group key (exact match only).** Built from *resolved* controlled-list identity — the real
   database id once a field resolves ('resolved'), or a stable `new:<name>` marker for a field
   that's about to be created ('new'). Never raw text compared fuzzily. Pens:
   `id:<brand>|id:<model>|id:<material>|id:<trim>` (or `new:` variants). Inks:
   `id:<brand>|id:<line>|<type>` (Type is a small fixed enum, compared as plain text, never
   resolved through `resolveOrFlag`).
2. **Free text (fuzzy or exact, only within a matching group).** The one field that's actually
   supposed to distinguish items sharing that identity — Color for pens, Name for inks. Only ever
   compared among candidates that already passed stage 1.

`duplicate-detection.ts`'s `findDuplicateMatches` signature changed from
`(compositeKey, existing, batch)` to `(groupKey, freeText, existing, batch)`, filtering candidates
to an exact groupKey match before scoring freeText similarity — see its own header comment for the
full mechanism.

**Two-phase detection, mirroring how Model/Line resolution already defers:**
- **Parse time** (`penIdentityGroupKey`/`inkIdentityGroupKey`): computable whenever every relevant
  field has a known identity (resolved or new) — returns `null` (defer to commit) only when a field
  is genuinely `'flagged'` (ambiguous), since there's no way to know its real identity yet. This
  mirrors why Model resolution already defers until Brand is known — the two mechanisms share the
  same root cause and the same fix shape.
- **Commit time**: a second, *universal* check runs right before `create(tx, pens/inks, {...})`,
  using each field's now-final resolved id — catches every row whose identity wasn't knowable at
  parse (brand flagged, or a genuinely new brand whose Model/Line piece needed the `new:` text
  marker), plus anything a mid-import correction changed. Skipped when `item.flag_type` is already
  `'possible_duplicate'` — otherwise a row already decided ("import anyway despite this known
  duplicate") would get its exact same match rediscovered and re-flagged, silently overriding a
  decision the reviewer already made. Confirmed reachable: correcting an unparseable Nib on an
  already-`possible_duplicate` row (a combination [[2026-07-10-flag-signals-are-not-mutually-exclusive]]
  made reachable) re-triggered the check and overrode the "import anyway" call before this gate was
  added.
- Both checks reuse the same re-flag-in-place mechanism from
  [[2026-07-10-re-flags-update-the-original-row]] — a commit-time discovery updates the *original*
  flagged-item row, not a new one, so retrying after deciding it actually converges.

**Existing-catalog identities simplified too:** `loadExistingPenIdentities`/`loadExistingInkIdentities`
now select the real FK columns directly (`pens.brand_id`, `pens.model_id`, …) with no joins at all —
comparing a row's own ids to another row's ids is always exact by construction, eliminating the
class of bug where the two sides' reconstructed-name field sets could silently drift apart (a real
bug fixed earlier in this same review).

**Consequences:**
- Re-ran the same real-file sanity check after the fix: `possible_duplicate` dropped from 265 to
  **11** (7 pens, 4 inks) — every remaining one inspected and confirmed a genuine, reviewable
  near-match (either an exact repeat, or names sharing real substrings like "Trust a Bivalve"/
  "Don't Trust a Bivalve"), never a false positive from shared boilerplate.
- `unparseable_nib` count in that same real-file run rose from 6 to 15 — not a regression: those 9
  rows were always genuinely bad nib text, but the old flood of false `possible_duplicate` flags
  outranked `unparseable_nib` as the headline `flag_type` for them (priority order, see
  [[2026-07-10-flag-signals-are-not-mutually-exclusive]]), hiding the real problem underneath.
  Clearing the false positives let it surface.
- A Model or Line typo against a brand-new brand is no longer caught by duplicate detection at
  all — it's caught by `resolveOrFlag`'s own fuzzy matching once that brand-new brand (and its
  first model/line) actually exists, at commit time, exactly like any other controlled-list
  ambiguity. Proven with a test creating two rows with the same brand-new brand where the second
  row's Model is a typo of the first's — first row commits within the transaction, second row's
  deferred model resolution finds the typo via read-your-own-writes, re-flags `needs_confirmation`
  rather than silently creating a near-duplicate model.
- The temporary sanity-check test itself was explicitly not permanent (Ken: *"this is not a
  permanent test that stays in the repo — it is a sanity check"*) and was deleted after use, per
  the working convention below.

**Working convention this established:** for verifying real-world behavior without violating
[[2026-07-09-no-cli-at-all-for-import]] or the standing rule that personal collection data never
enters the repo — write a throwaway integration test that reads the real CSVs from their actual
location outside the repo, calls `parseCatalogImport` only (never `commitImportAttempt` — that
would mean deciding on real data outside the UI), report findings, then delete the file. Not a
CLI (no entry point, no argv, nothing shipped), not a permanent fixture (real data never gets
copied into `tests/fixtures/`), just a diagnostic run through the exact same test harness every
other integration test already uses.
