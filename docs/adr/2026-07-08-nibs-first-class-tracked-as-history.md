# Nibs are first-class from pen acquisition, tracked as history, not overwritten

**Status:** Accepted

**Context:**
Corrects an earlier, wrong assumption that `inkings.nib_id` being null meant "the stock nib" —
that stops being well-defined the moment a swap happens.

**Decision:**
A pen's stock nib is a real `nibs` row from the moment it's acquired (not a placeholder), linked
via `pen_nibs` (install/remove dates). Swapping in a custom nib closes the stock nib's `pen_nibs`
row and opens a new one for the replacement.

**Consequences:**
- The stock nib keeps its full history and becomes a nib with no currently-open `pen_nibs` row
  (a loose nib in storage — exactly the case Phase 6's not-yet-designed nib-location tracking is
  meant to help find).
- The real source of truth for "what nib was in this pen on this date" is `pen_nibs`'s history,
  not a null check on a different table.
- `nibs.brand_id` is nullable for the same reason `point_size` needed real-data grounding: a bare
  point size in FPC's data ("F"/"M"/"B" alone) is a confirmed real case where the manufacturer
  genuinely isn't recorded — not a gap to force-fill.
- Relationship between `pen_nibs` and `inkings.nib_id` refined further — see
  [[2026-07-09-pen-nibs-inkings-independent-facts]].
