# `finishes` (renamed from `trim_colors`) is shared by pens and nibs

**Status:** Accepted

**Context:**
Nib finish (Black PVD, Rose Gold, etc. — confirmed real, distinct from base material) is the
same real-world vocabulary as a pen's trim color, not a separate concept.

**Decision:**
`pens.trim_color_id` and `nibs.finish_id` both point at one `finishes` table.

**Consequences:**
- Same reuse pattern as `maker_id` → `brands` and `nibmeister_id` → `vendors`, rather than a
  fourth near-identical controlled list.
