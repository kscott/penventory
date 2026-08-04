# Ink FPC import: field-by-field completeness review findings

**Status:** Accepted

**Context:**
Phase 1 step 9 — the same field-by-field completeness review the pens/nib half of the FPC import
already got (issue #15), applied fresh to `collected_inks.csv` and the ink half of
`fpc-import.ts`, which had never been through it. Verified against Ken's real 259-row export
directly, not assumed from `phase1-plan.md`'s original scoping notes.

**Decision:**

1. **Required-field validation now exists for inks.** `INK_REQUIRED_FIELDS` (`Brand`, `Name`,
   `Type`, `Color`) mirrors pens' `PEN_REQUIRED_FIELDS`, grounded in `inks`' actual `.notNull()`
   columns. A blank value in any of them produces `unparseable_row`, same as pens.

2. **`Type` is a closed 3-value enum, validated as a hard failure, not a reviewable field.** An
   out-of-set value is folded into the *same* `unparseable_row` mechanism as a blank required
   field (`inkRowProblems`) rather than a `needs_confirmation` flag — there's no `merge_into`/
   `alias_to` concept that makes sense for a fixed enum. Real data only ever has `bottle`/`sample`;
   `cartridge` never appears.

3. **Ink's `unparseable_row` correction path is implemented**, mirroring pens': re-run ink field
   resolution against the corrected `row_data.raw`, re-flag in place if still ambiguous, commit
   cleanly if fixed. `resolveInkFields`/`buildInkRowData` were extracted out of the parse loop so
   parse and commit-time correction share one implementation, same reasoning as
   `resolvePenFields`/`buildPenRowData`.

4. **`Tags` imports selectively, not wholesale — an explicit allow-list, not an exclude-list.**
   Real data: 189/259 rows have non-blank `Tags`, comma-separated, 15 unique words total. Two
   different things were mixed into one column:
   - `gifted`/`sold` are **ownership-change events, not tags.** They're pulled out of `Tags`
     entirely and become the `rehomed` reason as a freeform note (`"Rehomed: gifted"` /
     `"Rehomed: sold"`) appended alongside `Comment`/`Private Comment` — per PRD §5.5's existing
     "freeform note covers the circumstances" design for the `rehomed` ownership state, not a new
     schema column or a new `ownership_state` value. Confirmed real data: every row tagged either
     word already has `Archived=true`, and no row carries both.
   - Everything else is mostly personal shorthand Ken doesn't want carried over — color-descriptor
     labels (`azure`, `dark gold`, `magenta haze`, `ocean blue`, `ship grey`, `smalt blue`),
     gift-recipient names, one-off codes (`amazon`, `janelle`, `mojo`, `sushi`). Only three of the
     15 words function as ad hoc curation markers the way `gifted`/`sold` do and actually import as
     tags: `decide`, `reserved`, and `purgatory` (Ken's own words: "an indication that I may want
     to rehome the ink, but haven't decided"). `IMPORTABLE_STATUS_TAGS` is the allow-list;
     everything not on it is silently dropped, not imported.
   - Tags are exact-match only, created unconditionally (find-or-create by `tags.name`, no
     `field_decision` gate) — never `resolveOrFlag`-style fuzzy/alias-checked. They're informal
     user-curated free text, not a controlled collector vocabulary the way brand names are.

5. **`Private` stays unimported — no schema column.** Always `false` across all 259 real rows,
   zero signal either way. Reads like FPC's own community-sharing privacy flag, which has no
   meaning in a single-user app.

6. **`Comment`/`Private Comment` stay collapsed into one `notes` field** — unchanged from the
   original (untested-against-real-content) design. `Private Comment` is blank in all 259 real
   rows; with `Private` itself out of scope, the "hidden tier" rationale for a separate field goes
   away too.

7. **`Swabbed`/`Used`/`Usage`/`Daily Usage`/`Last Usage` are deliberately never read.** Two
   different reasons, not one:
   - `Swabbed` records a real, distinct action (has the ink actually been swatched) but doesn't
     map to `inks.swatched` — that's a Phase 3 computed column (true once a swatch photo exists).
     Ignored on import; Phase 3 recomputes it correctly once real swatch photos exist.
   - `Used`/`Usage`/`Daily Usage`/`Last Usage` are derived from usage entries, which arrive via a
     separate import (`currently_inked.csv` / `inkings`, Phase 4) or get created fresh in the app
     going forward. Nothing here needs FPC's own computed snapshot of them.

8. **The `Brand|Line|Type` duplicate-identity key is unchanged, Maker confirmed out.** Real-data
   check against all 259 rows: one genuine dupe (two "Birmingham Pen Co | Ohio River" bottles —
   one gifted away and archived, one bought fresh later), correctly caught by the key plus `Name`
   fuzzy-match. No row has the same `Name` with two different `Type`s. Everywhere `Maker` is set
   (Diamine for Akkerman, Octopus Fluids for Barock, Sailor for Bungubox) it's a real
   contract-manufacturer fact, orthogonal to what the ink actually is — a different maker doesn't
   make it a different ink.

**Consequences:**
- A real-file diagnostic re-run (temporary, parse-only, never-commit, deleted after use) against
  Ken's actual `collected_inks.csv` confirmed the numbers: 0 `unparseable_row`, 0
  `needs_confirmation` (fresh catalog), 4 `possible_duplicate` (Ohio River plus three genuine
  fuzzy-name near-matches within the same `Brand|Line|Type` group — e.g. "Trust a Bivalve" vs
  "Don't Trust a Bivalve" — correctly deferred to review, not auto-resolved either way), 61
  `gifted` + 2 `sold` reason notes, and exactly `decide`/`purgatory`/`reserved` as the tags that
  would be created.
- `IMPORTABLE_STATUS_TAGS` is a small, hand-maintained allow-list, not derived from any schema or
  config — adding a fourth status word later means editing `fpc-import.ts` directly.
