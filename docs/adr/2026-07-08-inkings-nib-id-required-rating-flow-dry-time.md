# `inkings.nib_id` is required; `rating` is 1-3 stars; `flow`/`dry_time` are scaled values

**Status:** Accepted

**Context:**
A pen can't be written with unless a nib is actually in it, so every real inking has one — no
nullable case. This corrects an earlier, still-wrong intermediate fix that only addressed the
"stock nib" assumption (see [[2026-07-08-nibs-first-class-tracked-as-history]]) without removing
nullability outright.

**Decision:**
`inkings.nib_id` is required, not nullable. `rating` is 1-3 stars, not 1-5. `flow`/`dry_time` are
`enum(high/medium/low)`, not booleans.

**Consequences:**
- `flow`/`dry_time` were originally lumped into the same boolean-checkbox redesign as
  `feathering_observed`/`sheen_observed` (see
  [[2026-07-08-performance-fields-boolean-columns]]), but they're scaled qualities, not yes/no
  occurrences of something happening — fixed to match every other scaled field in the schema.
