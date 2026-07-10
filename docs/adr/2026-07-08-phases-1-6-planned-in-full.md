# Phases 1-6 planned in full before any code beyond Phase 0

**Status:** Accepted

**Context:**
Ken wanted to see how the build upholds its stated principles (vertical slices, testing
discipline, no-CLI operability) before writing product code, rather than discovering gaps
mid-phase.

**Decision:**
Wrote `docs/phase1-plan.md` through `docs/phase6-plan.md` — ordered steps, gate per step, same
treatment `phase0-plan.md` got — expanding `project-plan.md`'s paragraph-level phase descriptions
into concrete, sequenced work.

**Consequences:**
Filled several gaps `project-plan.md` had left open:
- `/healthz` + `/metrics` (Containerization wanted both, no phase said when) → start of Phase 1,
  since Phase 0 is frozen.
- GHCR push + Portainer `secondo/personal-apps` stack wiring (described, not scheduled) → start
  of Phase 2, the first phase producing something worth running.
- `used`/`swatched` computed ink columns, listed in the schema as if present from Phase 1 —
  actually added once their dependency (`inkings`/`photos`) exists. Same reasoning applies to
  `pen_nibs` (later pulled forward — see
  [[2026-07-09-pen-nibs-pulled-forward-to-phase1]]) and `purchases`.
- New `ai_suggestion_logs` table (Phase 5) — makes "AI-derived content stays strictly separate
  from what Ken enters" a concrete, queryable fact rather than an unenforced policy.
