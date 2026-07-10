# Claude accesses Penventory via a Zod-validated HTTP API, not a skill

**Status:** Accepted

**Context:**
`vision.md` left the technical shape of Claude's access to Penventory explicitly open. Decided
at Phase 5 planning because it's load-bearing for how Phase 5 gets tested.

**Decision:**
Claude-the-agent is the sole consumer/reasoner over a Zod-validated HTTP API. The app itself
never calls an LLM.

**Consequences:**
- Keeps every Phase 5 service unit-testable with zero live external dependency, per
  [[2026-07-08-no-live-external-state-in-tests]].
- Full detail in `docs/phase5-plan.md`.
