# Penventory — Phase 4 Plan: Ledger and purchase history

The ledger core: nib assignment history, the shared purchase table across all three
entities, the Start/Mid/End inking lifecycle, standalone observations, wishlist, and
the two dashboard views the vision doc confirmed as worth keeping.

## Ordered steps

1. **Nib assign/remove UI + "current nib" query.** `pen_nibs`'s schema already exists
   — pulled forward into **Phase 1 step 5**, since the FPC import needed it to link
   an imported pen to its parsed stock nib. This step is the service/route/UI layer
   on top of that existing table, not the table itself: assign/remove nib to/from
   pen, and a "current nib for this pen" query (the open — `removed_on IS NULL` —
   `pen_nibs` row, if any). A pen's stock nib is already a real `nibs` row from
   acquisition (Phase 1's import), not a placeholder — swapping in a custom nib
   means closing the stock nib's `pen_nibs` row (`removed_on` set) and opening a new
   one for the replacement, not deleting or overwriting anything. The stock nib keeps
   its full install/remove history and becomes a nib with no currently-open
   `pen_nibs` row — i.e. a loose nib in storage, the exact case Phase 6's
   (not-yet-designed) nib storage/location tracking is meant to help find.
   *Gate:* full DoD tiers, plus a specific regression case: swap a pen's nib, assert
   the original nib's history is preserved (was installed from X to Y) and it now has
   no open `pen_nibs` row, while the new nib does.

2. **`purchases` (shared table).** Generic purchase-entry CRUD, polymorphic across
   pen/ink/nib (`purchasable_type` / `purchasable_id`), currency defaults to USD with
   easy override. `vendor_id` is a foreign key into Phase 1's `vendors` controlled
   list (not free text) — the same table `nibs.nibmeister_id` already points at, so
   a purchase from "PenRealm" and a grind by "Kirk Speer" resolve to one entity, not
   two disconnected strings. `vendor_id` is **nullable** — secondhand pens are
   usually bought from an individual (a one-time private sale), not a recurring
   business worth adding to the controlled list; `notes` covers "who" when
   `vendor_id` is left unset, rather than forcing every one-off seller through the
   same mechanism as a real recurring vendor.
   *Gate:* one parametrized test suite covering all three purchasable types through
   the same service — not three near-duplicate test files (the "shared structure,
   not three copies" principle from the vision doc, enforced in the test shape too),
   including a case with `vendor_id` null.

3. **Ink rebuy / bundled-ink $0 entries.** Purchase-history list surfaced on the ink
   record; bottle count = purchase-row count (answers "how many bottles do I actually
   have" — a real inventory question with no home in FPC). $0 entry path for bundled
   ink arriving with a pen.
   *Gate:* unit test for the bottle-count query against fixture purchase rows.

4. **Inkings ledger.** Start/End lifecycle, `rating` (1-3 stars, nullable). `nib_id` is
   **required** — a pen can't be written with unless a nib is actually installed, so
   every real inking has one. Performance and end-reason are **discrete boolean
   columns, not an enum or free text** — this is a direct fix, not the original
   design. Vision doc explicitly calls these "checkboxes" (plural — a cleaning could
   involve *both* "ran dry" and "ink issue" at once), but the field that shipped in
   earlier drafts of this schema was a single `end_reason` string (forces one
   choice, silently discards whichever reason didn't "win") and a single
   `performance_notes` text blob (the checkboxes existed only as a code comment,
   never real columns — reporting on any of it meant unreliable string-matching
   against prose, not real queries). Fixed: `ended_ran_dry` / `ended_disliked` /
   `ended_needed_pen` / `ended_ink_issue` (independently true/false, plus `end_note`
   freeform text alongside), and `feathering_observed` / `sheen_observed`
   (independently true/false — genuine yes/no occurrences) alongside `flow` /
   `dry_time` (`enum(high/medium/low)` — scaled qualities, not occurrences, so not
   booleans like the other two; `dry_time`'s direction stated explicitly since
   high/low is ambiguous for time without it), plus `performance_note` freeform text.
   Any combination is now directly filterable/groupable (`WHERE feathering_observed
   = true`, `WHERE ended_ran_dry = true AND ended_ink_issue = true`) with nothing
   depending on parsed prose. **`used` computed column added by migration here** —
   its dependency (`inkings`) now exists (see Phase 1's "Deferred columns" note).
   This is the core ledger feature.
   *Gate:* unit tests for the lifecycle state machine itself (can't End before Start,
   can't Start without a `nib_id`, can't Start a pen/nib that's already actively
   inked without ending the prior one, etc.); unit tests asserting multiple checkbox
   columns can independently be true on the same row (the specific regression this
   redesign exists to prevent); plus the full slice tiers.

   "Mid-use" notes (vision doc's third lifecycle moment, alongside Start/End) land
   via `observations.inking_id` — see step 6 below and `project-plan.md`'s
   `observations` table.

5. **Historical inkings import from `currently_inked.csv`** (deferred here from Phase 1
   — see `phase1-plan.md` step 7's note). Extends the same Ken-triggered CLI pattern
   from Phase 1 (`npm run import:fpc -- --currently-inked <path>`, dry-run report →
   reviewed decisions → `--commit`), not auto-run by Claude.

   The real problem here: `currently_inked.csv`'s `Pen`/`Ink` columns aren't IDs —
   they're reconstructed description strings (e.g.
   `Pelikan Souverän M800, Transparent Green, Acrylic, Gold, B 18K` for the pen,
   `Pilot Iroshizuku Kon-peki - bottle` for the ink, confirmed against Ken's real
   export). Each row has to be fuzzy-matched against the by-then-populated
   `pens`/`inks` catalog (built from Phase 1's import) to resolve a `pen_id`/`ink_id`
   before it can become an `inkings` row. Ambiguous or unmatched rows go into the same
   review-report pattern as Phase 1's catalog import — flagged, not guessed, and
   nothing commits until Ken's resolved every flag.
   *Gate:* unit tests for the description-string matching/scoring logic against
   fixture rows (exact match, near-miss, ambiguous/multiple-candidate cases);
   integration test for the commit-from-reviewed-report path, asserting each imported
   row becomes a correctly-linked `inkings` row (`started_on`/`ended_on` from Date
   Inked/Date Cleaned, `ended_on` null where FPC shows no cleaning date — i.e. still
   loaded).

6. **Observations.** Standalone dated notes for pen/nib, independent of any active
   inking (e.g. "became my desk pen," a condition note).
   *Gate:* same tiers, smaller slice.

7. **Wishlist.** Save/convert flow — preserved-hidden pattern, same as ownership
   state: never deleted, drops from the active view once `converted_at` is set, still
   queryable for stats (e.g. "how many wishlisted inks actually get bought").
   *Gate:* test asserts conversion creates the real ink record with carried-over
   fields (name, brand, line, notes) **and** the wishlist row persists with
   `converted_ink_id` / `converted_at` set and is excluded from the default view.

8. **Reporting: longest-untouched list + currently-inked board.** Read-only queries —
   `min(last inking start / observation date)` ascending across pens and inks;
   `inkings WHERE ended_on IS NULL` for the board.
   *Gate:* unit-test the "days since" calculation with an injected fixed clock, not
   real `Date.now()` — deterministic, not flaky.

## Definition of done

Full ledger lifecycle usable end-to-end. Purchase history (with rebuy/bundled-ink
handling) and wishlist are both real, not deferred stubs. The two dashboard views from
the vision doc's Reporting section exist and read live ledger data. The historical
`currently_inked.csv` import CLI exists and is tested against fixtures — same as
Phase 1's catalog import, actually running it against Ken's real export is his call,
on his schedule, not part of this phase's done-ness.
