# Constrained-value fields use `enum(...)` notation, not `string (...)`

**Status:** Accepted

**Context:**
The `string (...)` notation in schema docs read identically to genuinely free-text fields
(`notes`, `custom_name`) and caused real confusion — "the string designation confuses" (Ken).

**Decision:**
Applied `enum(...)` notation across every constrained field in `project-plan.md` —
`size_category`, `condition`, `ownership_state`, `purity`, `base_size`, `point_size`, `type`,
`sheen`, `shading`, and all polymorphic type-discriminator columns (`purchasable_type`,
`subject_type`, `owner_type`, `kind`, `aliasable_type`, `taggable_type`, `intent`). `feedback`,
nib `wetness`, ink `wetness`/`flow`/`dry_time` all resolved to `enum(high / medium / low)` —
spelled out in full, not "H/M/L" shorthand (Ken: "I'm using h/m/l as shortcut. I think the app
should use high/medium/low").

**Consequences:**
- `dry_time` states its direction explicitly (high = slow/long to dry, low = fast) since
  high/low is inherently ambiguous for a time concept without it.
