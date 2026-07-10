# `observations.inking_id` confirmed: one table for standalone notes and "Mid-use" notes both

**Status:** Accepted

**Context:**
Resolves `vision.md`'s third lifecycle moment (Start/Mid-use/End), which had no home in the
schema.

**Decision:**
`subject_type`/`subject_id` and `inking_id` are mutually exclusive on a given `observations` row
— an inking-attached observation doesn't need its own subject reference, since the inking it's
attached to already implies which pen/ink/nib it's about.

**Consequences:**
- Multiple observations can attach to one inking over its life.
