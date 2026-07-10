# Coverage threshold: 90%, enforced in CI

**Status:** Accepted

**Context:**
Testing discipline needed a concrete, enforced number, not just "write tests."

**Decision:**
Vitest + `@vitest/coverage-v8`, gated at 90% minimum. The build fails below it — not just
reported in a dashboard.

**Consequences:**
- A starting point, not a ceiling — may raise later, won't lower.
- Applies from Phase 0 onward, before any feature code exists.
