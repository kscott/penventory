# Architecture — Decision Log

Current structure and the running record of decisions made. Update this whenever something
structural changes: new file, new type, extracted function, deferred observation. Decision log
for decisions made; improvement backlog for things noticed but not acted on. This document is
how continuity holds across sessions.

## Decision log

**2026-07-06 — Stack.** Node.js (`node:22-slim`) + SvelteKit + SQLite + Drizzle ORM + `colorjs.io`
+ `sharp` + Zod + Vitest + Playwright + `pino` + `prom-client`. Full reasoning per layer in
`docs/project-plan.md`'s Stack table. Rails was the original plan (see old project-plan, now
superseded) — replaced after the vision/PRD revision session made the visuals-first, animation-
heavy browse experience (`animate:flip`) the actual point of the app.

**2026-07-06 — Layered architecture.** `routes/` → `lib/server/services/` → `lib/server/db/` +
`lib/shared/`. Routes stay HTTP-only so services can be unit-tested without spinning up the app,
and repositories can be swapped for fakes without touching real SQLite.

**2026-07-08 — Coverage threshold: 90%, enforced in CI.** Vitest + `@vitest/coverage-v8`. Not
just reported — the build fails below it. May raise later; starting point, not a ceiling.

**2026-07-08 — No code path may require live external system state to be tested.** Stronger than
"isolate it behind a fake" — if a dependency would introduce that requirement, the dependency is
the wrong choice and gets rethought, full stop. Named explicitly against get-clear's EventKit/
Contacts boundary, which genuinely can't run in CI without a live Mac. Penventory's stack has no
equivalent: SQLite runs in-process and is tested against a real instance (not a fake), `sharp`
and `colorjs.io` are pure library calls, SvelteKit routes are thin HTTP wrappers.

**2026-07-08 — Docs live in the repo, not in Notes.** `docs/vision.md`, `docs/PRD.md`,
`docs/project-plan.md`, `docs/phase0-plan.md` moved from `~/Notes/personal/ink-collection/` into
this repo's `docs/`. Rationale: project documentation belongs with the code it describes,
versioned alongside it. Raw FPC export data and the prototype color-clustering scripts
(`gen_inks.py` and friends) stay in Notes — personal source data and standalone tooling, not
project documentation, and not superseded by this repo existing.

**2026-07-08 — Dev workflow: one-issue-one-branch, close before merge.** Same process as
get-clear. Single-user doesn't mean less rigor.

## Improvement backlog

Nothing yet — Phase 0 hasn't started.
