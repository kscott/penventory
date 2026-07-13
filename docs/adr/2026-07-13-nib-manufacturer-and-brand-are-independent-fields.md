# `nibs.manufacturer_id` and `nibs.brand_id` are two independent fields, not one

**Status:** Accepted

**Context:**
Surfaced during a field-by-field completeness review of the FPC import's Nib parsing (same rigor
already applied to pens — see [[project_phase1_review_decision_pending]]). The original schema had
a single nullable `nibs.brand_id`, with `import`'s comment explicitly stating it was left null
always, since "JoWo vs. Bock vs. other isn't knowable from this data."

That reasoning conflated two genuinely independent real-world facts: who physically manufactures
the nib blank (JoWo, Bock, Schmidt — most third-party nibs), and who brands/sells/customizes it
(Pilot, Sailor, Esterbrook, Franklin-Christoph). Ken's concrete example: a JoWo blank can be
distributed and further customized by Esterbrook or Franklin-Christoph — manufacturer and brand
differ, and both are worth recording when known. A single column can't hold both without exactly
that collision.

Separately, while walking the real `Nib` column's distinct values, four point-size-like codes
turned out to be a specific vertically-integrated maker's own proprietary nib design, not a
generic width grade: Pilot's **Signature** (round) and **CM** ("Calligraphy Medium" — a 1mm
Stub, not round despite no explicit shape token), Sailor's **Zoom** (architect-style) and
**Music** (round, 3-tine, 21K in every case seen). For these, manufacturer and brand are the
same maker — a real, useful fact, not a redundant duplicate.

**Decision:**
1. `nibs` gets a second nullable FK, `manufacturer_id`, into the same `brands` table as
   `brand_id`. No `CHECK` or other constraint ties the two together — they're independent columns
   that can be equal (a vertically-integrated maker, e.g. `brand_id == manufacturer_id == Pilot`),
   different (`manufacturer_id == JoWo`, `brand_id == Esterbrook`), or either/both null (the
   common case — Ken expects `manufacturer_id` to be empty most of the time). The rule isn't
   "never let them overlap," it's "populate whichever of the two you actually know" — an
   *unearned* duplicate (stuffing a brand into a generic, unbranded third-party blank just because
   the manufacturer is known) is the thing to avoid, not overlap itself.
2. `parseNibText` gains a `POINT_SIZE_MAKER` table mapping Signature/CM/Zoom/Music to their
   brand+manufacturer (and, for Zoom and CM, an implied shape — Architect and Stub respectively —
   overriding the Round default; an explicit shape token in the text still wins over the
   implication). `ParsedNibText`'s `parsed` variant carries `brandName`/`manufacturerName`
   alongside the existing material/shape/finish name fields, resolved through the same
   `resolveOrFlag`/`applyDecision('brand', ...)` machinery pens' own `Brand` field already uses —
   no new resolution mechanism, same controlled list.
3. `NIB_POINT_SIZE_SEED` gains `Signature`/`Zoom`/`Music`/`C` (Coarse — a real, generic vintage
   grade, not brand-specific) and drops `OM`: "Oblique" turned out to be a real nib *shape*
   (confirmed universal, also seen combined with B/BB/BBB, not just M) that's conventionally
   glued directly onto a width code with no separating space, unlike every other shape word.
   `parseNibText` now strips a leading `O` off a token when the remainder is itself a known point
   size and records `Oblique` as the shape — generalizing automatically to any width (OB/OBB/OBBB)
   rather than needing its own atomic seed entry per combination.

**Consequences:**
- Seeding a new point-size grade remains a code+migration change (a hand-authored `--custom`
  migration, same as the original seed), not a live "add new value" decision through the review
  UI — point size still has no default and no `findOrCreateExactMatchWithDecision`-style flagged
  pathway, unlike base_size/purity. That asymmetry is an existing, deliberate design choice (see
  [[2026-07-09-nib-value-lookup-tables-not-enums]]), not something this decision changes.
- This is a first pass, not a closed system: Ken named six known vertically-integrated makers
  (Pelikan, Scribo, Pilot, Sailor, Platinum, Aurora) but only Pilot/Sailor's proprietary point
  sizes are wired in — the rest have no textual signal in FPC's `Nib` column to key off yet.
  Extending `POINT_SIZE_MAKER` or adding a live manufacturer/brand entry path is real,
  not-yet-designed future work (Phase 3 nib CRUD, most likely).
- Full names for point-size codes (Fine/Medium/Broad, etc.) were considered and explicitly
  declined as stored data — Ken has been consistent about never using them; if ever wanted, it's a
  UI-only display concern, not a schema column.
