# `models` table added for pens; `nibs.brand` and `pens.model` fixed to foreign keys

**Status:** Accepted

**Context:**
Cross-checking the schema against `vision.md` and the "fat-fingered duplicate" discussion found
two real bugs, not stylistic nits.

**Decision:**
(1) `nibs.brand` was free text, not a foreign key to `brands` like pens and inks have — same
spelling-drift risk, no reason for the inconsistency, fixed. (2) `pens.model` was free text with
no controlled list, even though `vision.md` explicitly says Line-style controlled lists "apply to
pens and inks both." Added a `models` table (brand-scoped, same shape as `lines`) and
`pens.model_id` as a foreign key to it.

**Consequences:**
- `project-plan.md`'s original schema never implemented brand-scoped models for pens — this
  closes that gap before Phase 1 code exists, not after.
