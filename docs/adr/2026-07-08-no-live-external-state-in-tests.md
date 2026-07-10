# No code path may require live external system state to be tested

**Status:** Accepted

**Context:**
Named explicitly against get-clear's EventKit/Contacts boundary, which genuinely can't run in CI
without a live Mac. Wanted to know up front whether Penventory's stack has an equivalent trap.

**Decision:**
Stronger than "isolate it behind a fake." If a dependency would introduce a live-external-state
testing requirement, the dependency itself is the wrong choice and gets rethought — full stop,
not isolated and shipped anyway.

**Consequences:**
- Confirmed Penventory's stack has no equivalent: SQLite runs in-process and is tested against a
  real temp-file instance (not a fake); `sharp` and `colorjs.io` are pure library calls;
  SvelteKit routes are thin HTTP wrappers.
- Single-user doesn't earn an exception — this rule applies at the same strength regardless of
  scale.
- Every later dependency decision (SQLite driver, CSV library, fuzzy-match library) gets checked
  against this rule.
