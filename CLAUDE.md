# Penventory — Claude Instructions

## Start every session

Read the session log before doing anything else:

```
~/Library/Mobile Documents/com~apple~CloudDocs/Productivity/session-log.md
```

Current ISO week only, resets each Monday, syncs across machines. Older weeks archive monthly at
`.../Productivity/Archive/session-logs/session-log-YYYY-MM.md`. Reconstruct context from it before
asking Ken to re-explain anything already there.

## Before writing any code

Read these every session, without exception:

- `docs/vision.md` — the why/what, settled through an interview with Ken. Source of truth for
  product decisions.
- `docs/PRD.md` — the product itself, generated from `vision.md`.
- `docs/project-plan.md` — the technical translation: stack, architecture, testing discipline,
  data model, phases, containerization, infrastructure.
- `docs/phase0-plan.md` — current phase, ordered steps, gate per step. Superseded by a
  `docs/phaseN-plan.md` for whichever phase is active once Phase 0 closes.
- `ARCHITECTURE.md` — decision log. How continuity holds across sessions without re-deriving
  settled decisions.

Raw FPC export data and the prototype color-clustering tooling that inspired this project
(`gen_inks.py` and friends) live at `~/Notes/personal/ink-collection/` — not in this repo. That
folder is personal source data, not project documentation.

## Testing discipline — held without exception

1. **Testing infrastructure lands before any feature code.** Phase 0 exists specifically to prove
   lint, typecheck, unit, e2e, and CI are all green before a single Pen/Ink/Nib model exists.
2. **Vertical slices, not horizontal layers.** One thin end-to-end feature at a time — schema →
   repository → service → route → UI — fully tested at every layer, before starting the next
   slice. Never "build everything, then add tests."
3. **Definition of done, per slice:** a unit test for new service logic; an integration test if
   it touches the database; a contract test for any new/changed API endpoint; a Playwright test
   for anything user-visible. Missing any of these means the slice isn't done.
4. **CI blocks bad code from landing.** Lint, typecheck, unit, integration, e2e smoke, and a
   Docker build run on every push. Nothing merges with a red pipeline.
5. **Coverage is enforced, not just reported.** Vitest coverage (`@vitest/coverage-v8`), **90%
   minimum threshold gated in CI.** May raise later; won't lower.
6. **No code path may require live external system state to be tested.** If a future dependency
   would introduce that requirement, the dependency choice is wrong and gets rethought — it does
   not get isolated behind a fake, it does not get included. Single-user doesn't mean less rigor.
7. Nontrivial changes get run through `/verify` (actually exercising the change end-to-end)
   before being called done — tests passing isn't sufficient on its own.

## Development workflow

Same as get-clear — single-user doesn't earn a lighter process. One issue at a time on a local
feature branch:

```bash
git checkout -b issue-N         # start
# work, commit...
                                 # review DoD, pick nits until satisfied
gh issue close N                # close BEFORE merging — branch stays live until nothing is left
git checkout main && git merge issue-N && git branch -d issue-N
```

`gh` CLI for all GitHub operations. `git push origin` to push.

## Build and test

Not yet scaffolded — Phase 0 in progress. This section gets filled in as each piece lands
(package.json scripts for lint/typecheck/test/build, Docker build command, etc.).

## Architecture

```
routes/                    SvelteKit routes — HTTP-only concerns (parse request, call a
                            service, format response). No business logic here.
lib/server/services/       Business logic — ledger rules, near-dupe clustering, purchase-
                            history aggregation, tag AND/OR filtering. Framework-agnostic,
                            depends on repository *interfaces* not Drizzle directly.
lib/server/db/             Drizzle schema + repository functions. The only layer that
                            imports Drizzle.
lib/shared/                Zod schemas, shared between client and server, and the documented
                            contract Claude's own queries validate against.
```

Full rationale in `docs/project-plan.md`.
