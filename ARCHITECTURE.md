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

**2026-07-08 — Phases 1–6 planned in full before any code beyond Phase 0.** Ken wanted to see
how the build upholds the stated principles before writing product code. Produced
`docs/phase1-plan.md` through `docs/phase6-plan.md` (ordered steps, gate per step, same
treatment `phase0-plan.md` got), expanding `project-plan.md`'s paragraph-level phase
descriptions. Filled several gaps `project-plan.md` left open:
- `/healthz` + `/metrics` (Containerization wanted both, no phase said when) → start of
  Phase 1, since Phase 0 is frozen.
- GHCR push + Portainer `secondo/personal-apps` stack wiring (described, not scheduled) →
  start of Phase 2, the first phase producing something worth running.
- `used`/`swatched` computed ink columns, listed in the schema as if present from Phase 1 —
  actually added by migration in Phase 4/Phase 3 respectively, once their dependency
  (`inkings`/`photos`) exists. Same reasoning applies to `pen_nibs` and `purchases` (Phase 4).
- New `ai_suggestion_logs` table (Phase 5) — makes "AI-derived content stays strictly
  separate from what Ken enters" a concrete, queryable fact rather than an unenforced policy.

**2026-07-08 — Local container runtime: `apple/container`, not OrbStack/Docker Desktop.**
Phase 0 step 6 needed something to verify `docker build` locally on this Mac (no runtime was
installed at all). Tried OrbStack first (brew cask) — works, but its onboarding defaults to a
Pro trial banner, an unnecessary licensing question for what's just a dev-loop build check.
Switched to Apple's own `container` CLI (`brew install container`, v1.1.0): Apache 2.0, fully
open source, no license tier at all, and it's the native fit for this Mac (Apple Silicon +
macOS 26 Tahoe, both already true here). It's OCI-compatible — builds/runs the same Dockerfile,
pulls/pushes the same registries — so nothing about the Dockerfile or CI (which still runs
`docker build` on GitHub-hosted Ubuntu runners, unchanged) depends on this choice. One
networking difference worth knowing: each container gets its own routable IP on a private
subnet rather than Docker's NAT+localhost port-publish — `container run -p` didn't map to
`localhost` in testing; hitting the container's own IP (`container list` shows it) worked.

**2026-07-08 — Claude accesses Penventory via a Zod-validated HTTP API, not a skill.**
Resolves the vision doc's explicitly-open question about the technical shape of Claude's
access. The app itself never calls an LLM — Claude-the-agent is the sole consumer/reasoner
over the API. Decided at Phase 5 planning because it's load-bearing: it's what keeps every
Phase 5 service unit-testable with zero live external dependency, per the "no code path may
require live external system state to test" rule above. Full detail in `docs/phase5-plan.md`.

## Improvement backlog

Nothing yet — Phase 0 hasn't started.
