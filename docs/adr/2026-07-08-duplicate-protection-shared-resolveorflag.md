# Brand/Line/Model duplicate protection lives in a shared repository function, not the UI

**Status:** Accepted

**Context:**
A near-duplicate ("Piolt" vs. "Pilot") can't be allowed to silently create a new row just
because a picker UI existed and nobody happened to look at it — "a fat-fingered typo will go
into the system and give us dirty data... we can't rely on progressive exposure being
sufficient" (Ken).

**Decision:**
One shared `resolveOrFlag(type, name, brandId?)` function, parametrized across brand/line/model
rather than three copies, with four outcomes checked in order: exact match, known-alias match,
fuzzy-similar (flagged, never auto-created), or genuinely new. Both the bulk FPC import and any
future manual-entry UI call the same function.

**Consequences:**
- The no-silent-dirty-data guarantee holds regardless of whether the UI is well-designed —
  correctness lives at the repository layer, not in each caller.
- Known-alias resolution (e.g. "Namiki" → "Pilot", a real sub-brand name with zero string
  similarity to "Pilot" — nothing a similarity algorithm could infer) uses a new polymorphic
  `aliases` table (same pattern as `taggables`/`purchases`), curated from Ken's own domain
  knowledge, not computed.
- Later extended to five more field types — see
  [[2026-07-08-controlled-list-extended-five-fields]] — and refined with a second matching
  signal — see [[2026-07-09-resolveorflag-two-signals]].
- Full detail in `phase1-plan.md` steps 2-3 and 6.
