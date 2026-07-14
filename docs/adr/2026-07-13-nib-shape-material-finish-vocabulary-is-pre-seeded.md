# `nib_shapes`/`nib_materials`/`finishes` are pre-seeded from real data, not left empty

**Status:** Accepted

**Context:**
Continuing the same field-by-field Nib review that produced
[[2026-07-13-nib-manufacturer-and-brand-are-independent-fields]]. Unlike `nib_purities`/
`nib_base_sizes`/`nib_point_sizes`, the `nib_shapes`/`nib_materials`/`finishes` controlled lists
were never seeded — they're ordinary `resolveOrFlag`-style open-ended vocabularies, so seeding
them felt unnecessary at the time.

That reasoning missed a real interaction: `parseNibText` does its own phrase-matching against
these tables *before* a value ever reaches `resolveOrFlag`. An unmatched word doesn't get offered
to `resolveOrFlag` as a "new value" candidate the way `nib_base_size`/`nib_purity` unrecognized
tokens do (via `NibFieldFlag` + `findOrCreateExactMatchWithDecision`) — it silently falls into
`custom_name` with the material/shape defaulted (Steel/Round), and `resolveOrFlag` never sees it.
On a genuinely empty database — Ken's real first import — that meant most of the descriptive words
in his real `Nib` column (Titanium, Cursive Italic, Rose Gold, Stub, Architect, etc.) would never
be recognized as structured data, only as opaque custom-grind text.

**Decision:**
Seed `nib_shapes`, `nib_materials`, and `finishes` with what's already confirmed in Ken's real
`collected_pens.csv`/`collected_pens.csv` Trim Color column (`NIB_SHAPE_SEED`/`NIB_MATERIAL_SEED`/
`FINISH_SEED` in `schema.ts`, migration `0009`):
- `nib_shapes`: Round, Stub, Cursive Italic, Cursive Smooth Italic, Architect, Italic, Oblique,
  Scribe, Imperial. "Journaler"/"Scribe"/"Imperial" are publicly-known nibmeister grinds
  popularized through Esterbrook (Ken, 2026-07-13), not manufacturer stock shapes — see
  `nib-parser.ts`'s `NIBMEISTER_GRIND` and the nibmeister paragraph below. "Journaler" resolves via
  a `Journaler` → `Cursive Smooth Italic` alias (phase1-plan.md's own original example named this
  same alias but guessed plain "Cursive Italic" as the target — corrected); "Scribe" and "Imperial"
  (a Stub variant, half-round and flat on top) are their own shape names directly, same as
  "Architect" — no alias layer needed.
- `nib_materials`: Steel, Gold, Titanium.
- `finishes`: shared with pens' own Trim Color (same table), seeded with the combined real
  vocabulary. `Gold`/`Silver` are seeded as **`Gold Tone`/`Silver Tone`** with `Gold`/`Silver` as
  raw-text aliases — Ken's real trim colors describe plating *tone*, not literal composition
  (tracked separately on `pens.material_id`, e.g. "Sterling Silver"). `Copper`/`Bronze` are
  deliberately left as literal, unaliased names — Ken has a couple of pens with genuine
  copper-metal trim mixed in among copper-*toned* ones, indistinguishable from raw text alone; a
  blanket Tone alias would silently mislabel the real-metal exceptions with no chance to catch it.
  `Gunmetal` is its own specific named finish (same bucket as Rhodium/Ruthenium/Rose Gold), not a
  generic tone. All confirmed directly with Ken, 2026-07-13.

This is explicitly a starting list, not exhaustive — a genuinely new word still works exactly as
before (falls through to `custom_name`, correctable later), this just closes the gap for what's
already known.

**`nibs.nibmeister_id` is populated by import for the first time.** The field already existed
(`nibmeister_id` → `vendors`) but nothing in `fpc-import.ts` had ever set it — every nibmeister
fact was silently lost. `NIBMEISTER_GRIND` in `nib-parser.ts` maps each nibmeister-grind shape word
to its nibmeister (and, for Journaler/Scribe, an implied point size when no width is given —
Imperial has none of its own, so bare `"Imperial"` still correctly stays `unparseable_nib`):
Journaler is Gena Saloreno's grind, Scribe is Joshua Lax's, Imperial is Kirk Speer's. The
nibmeister fact applies whenever the word appears at all, independent of whether its point size is
explicit or implied (`"M Journaler"` is still Gena Saloreno's grind). Resolved through the same
`resolveOrFlag('vendor', ...)` mechanism as any other vendor, at all three of the places
`nib_brand`/`nib_manufacturer` already are (parse-time resolution, unparseable-nib re-resolution,
commit-time creation) — no new resolution mechanism. A nibmeister grind is always
`is_custom_grind: true`, even though its shape resolves via known vocabulary just like a
manufacturer's stock shape — it's still an aftermarket modification of someone else's blank, not
how the nib came from the factory. `brand_id`/`manufacturer_id` stay null for these — distinct from
`POINT_SIZE_MAKER`'s manufacturer-branded point sizes (Signature/Zoom/Music/CM), which are a
maker's own stock design, never `is_custom_grind`.

**A real, independent bug surfaced while adding this seed data**, not just a data gap: seeding
`Gold` as a `nib_material` broke `"F Rose Gold"` parsing — `materialName` resolved to `"Gold"` and
`"Rose"` was left as orphaned `custom_name`, with the finish silently dropped. Cause: shape,
material, and finish were extracted as three separate *sequential* greedy passes (shape, then
material, then finish) — the single-word material phrase `"Gold"` matched and consumed that token
before the finish pass ever got a chance to try the longer, more specific `"Rose Gold"` phrase.
This wasn't only a consequence of seeding — any bare-purity nib in Ken's real data (`"B 18K"`)
defaults `materialName` to `"Gold"`, which becomes a real `nib_materials` row on the very first
commit; every `Rose Gold` finish parsed afterward would have silently broken the same way, seed
data or not. Fixed by combining all three vocabularies into one longest-phrase-first extraction
(`extractCategorizedPhrases` in `nib-parser.ts`) instead of three independent sequential ones, so
a longer phrase from any category always wins over a shorter one from another, never just
whichever category happens to run first.

**Consequences:**
- `catalog.integration.test.ts` gained a seed-verification test (same pattern as the existing
  purity/base_size/point_size one) asserting the DB rows match `NIB_SHAPE_SEED`/
  `NIB_MATERIAL_SEED`/`FINISH_SEED` exactly, plus the `Journaler`/`Gold`/`Silver` aliases resolve
  to the right canonical rows.
- Several existing tests that manually seeded now-pre-seeded values (`Gold`, `Round`, `Cursive
  Italic`, `Rose Gold`, `Titanium`, `Journaler`) hit `UNIQUE constraint` failures or silently wrong
  "first row" assumptions once the table was no longer empty by default — fixed by removing the
  now-redundant inserts, switching a few "assert exact table length" assertions to "assert no
  *additional* row was created" (`.filter(...)` instead of `.toHaveLength`), and renaming test
  fixtures that used `"Journaler"` as an example of an *unrecognized* word (it now resolves via
  the seeded alias) to a fictional `"Feathertip"` instead.
- The "bare point size's default material collides with an existing near-miss typo" test (pens
  field-by-field review gap #5, 2026-07-10) no longer reproduces for `Steel` specifically —
  seeding it as an exact, permanent value means `resolveOrFlag` always finds it via exact match
  before ever reaching fuzzy comparison. Rewritten to assert that resolution, documenting the
  gap's closure rather than deleting the coverage. The equivalent class of bug is still reachable
  for `nib_brand`/`nib_manufacturer`, though — `brands` has no seed data at all, so a maker name
  like `"Pilot"` can still fuzzy-flag against an existing typo (`"Piolt"`); covered by a new test.
