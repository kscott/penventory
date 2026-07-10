# Nib `point_size` absorbs stub/italic mm widths; `line_width`/`line_variation` dropped

**Status:** Accepted

**Context:**
Real data showed stub-style widths (1.0/1.1/1.4/1.5mm) playing the identical role
`point_size`'s letter codes play for round nibs — same underlying fact (nib width), different
notation by convention.

**Decision:**
Added stub/italic widths to the same `point_size` enum rather than a separate field. Dropped
`line_width` and `line_variation` — inherited from the original pre-review schema draft and
never re-derived against real data or `vision.md`.

**Consequences:**
- `point_size` now covers what `line_width` was guessed to mean; nothing replaced
  `line_variation`.
- `point_size` later became a real lookup table rather than a TypeScript enum — see
  [[2026-07-09-nib-value-lookup-tables-not-enums]].
