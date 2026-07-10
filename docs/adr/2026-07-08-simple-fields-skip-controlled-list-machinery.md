# Not everything with a fixed vocabulary needs the controlled-list machinery

**Status:** Amended by [[2026-07-09-nib-value-lookup-tables-not-enums]] (storage mechanism
changed from TypeScript enum to lookup table; the no-fuzzy-matching conclusion below is
unchanged)

**Context:**
`purity`, `base_size`, and `point_size` on `nibs` were being pulled toward the same
controlled-list-with-fuzzy-matching machinery as brand/line/model, without checking whether that
machinery actually fits.

**Decision:**
These stay plain constrained values (originally: Zod enum/check constraint), not
controlled-list tables with fuzzy matching — small, stable, standardized vocabularies where the
fuzzy-matching machinery would do active harm.

**Consequences:**
- Concrete proof: `point_size`'s real data has "FM", "MF", and "F/M" as three genuinely distinct,
  valid values (Pilot/Sailor/Diplomat's own conventions for a similar concept), not a typo
  cluster — a fuzzy matcher would have wrongly flagged them as near-duplicates of each other.
- Lesson generalized: string similarity alone doesn't distinguish "typo of the same thing" from
  "different vendors' names for adjacent but distinct things" — that distinction needs domain
  knowledge (Ken's), which is why these fields stay simple rather than growing the same fuzzy
  machinery everywhere.
