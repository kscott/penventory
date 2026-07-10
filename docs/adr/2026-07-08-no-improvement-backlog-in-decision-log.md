# No improvement backlog mixed into the decision record

**Status:** Accepted — carried forward into [[2026-07-10-adr-decision-log-split-from-architecture-guide]]

**Context:**
`ARCHITECTURE.md` was previously structured as "decision log for decisions made; improvement
backlog for things noticed but not acted on" — a known anti-pattern from get-clear, where the
backlog section degrades into a todo list embedded in what's supposed to be a pure decision
record.

**Decision:**
Removed the improvement-backlog section entirely. Something noticed but not yet decided gets a
GitHub issue or a line in `docs/punch-list.md`, not a section in the decision record.

**Consequences:**
- The rule outlives the file split — it applies to `docs/adr/` now just as it applied to
  `ARCHITECTURE.md`'s decision log before: decisions only, never a todo list.
