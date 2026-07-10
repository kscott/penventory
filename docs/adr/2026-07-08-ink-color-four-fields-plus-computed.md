# Ink color is four independent stored fields plus one computed "effective" value

**Status:** Accepted

**Context:**
Corrects an earlier draft that would have copied FPC's value into a general-purpose `color`
field at import time. Ken's objection: FPC's own color value is itself crowdsourced across all
its users and can legitimately change over time — "FPC lives in FPC," never silently blended
into another field.

**Decision:**
`color_fpc`, `color_swatch`, `color_colorimeter`, `color_community` are four independent,
nullable-except-fpc stored values. `color_override_source` is Ken's explicit pointer at which one
is authoritative for a specific ink. `color` itself is COMPUTED at read time by a
lookup-hierarchy service, never stored or duplicated — same pattern already used for
`used`/`swatched`/`color_family`. Default precedence when nothing is manually overridden: swatch
→ colorimeter → fpc.

**Consequences:**
- `color_fpc` gets its own explicit, narrow refresh operation (`phase1-plan.md` step 8) —
  matched-only, diff-reviewed, updates only that one field — since re-syncing a legitimately-
  changed FPC value is a different, safer operation than the main import's create-new-rows path.
- `color_colorimeter` is populated by an import of `colorimeter.csv`, scheduled to Phase 4 (not
  Phase 3) — it reuses the more refined match/diff/review pattern established by then rather than
  a one-off Phase 3 bolt-on.
