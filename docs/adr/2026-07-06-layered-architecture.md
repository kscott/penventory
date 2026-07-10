# Layered architecture: routes → services → db + shared

**Status:** Accepted

**Context:**
Needed a structure where business logic (ledger rules, near-dupe clustering, tag filtering) can
be unit-tested without spinning up the app or touching real SQLite.

**Decision:**
`routes/` → `lib/server/services/` → `lib/server/db/` + `lib/shared/`. Routes stay HTTP-only
(parse request, call a service, format response) — no business logic there. Services depend on
repository *interfaces*, not Drizzle directly.

**Consequences:**
- Services are unit-testable in isolation.
- Repositories can be swapped for fakes without touching real SQLite (though in practice this
  project tests against a real temp-file SQLite instead — see
  [[2026-07-08-no-live-external-state-in-tests]]).
- Full rationale in `project-plan.md`.
