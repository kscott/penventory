# Penventory

A self-hosted fountain pen collection manager, built from scratch to replace Fountain Pen
Companion (FPC) — full control, real depth on nib data, and actual reporting instead of a static
catalog. Single-user, self-hosted, not a SaaS product.

## Where things stand

Vision, PRD, and the full technical plan are settled. Phase 0 (tooling/CI scaffold — no product
code) is the current phase. See `docs/phase0-plan.md`.

## Docs

Read in this order to reconstruct full context:

1. `docs/vision.md` — the why/what, built through an interview with Ken. Primary product
   reference.
2. `docs/PRD.md` — the product itself, generated from `vision.md`.
3. `docs/project-plan.md` — the technical translation: stack, architecture, testing discipline,
   data model, feature phases, containerization, hosting/GitOps.
4. `docs/phase0-plan.md` — current phase, ordered steps, and the testing gate each step has to
   clear. `docs/phase1-plan.md` through `phase6-plan.md` cover the phases after it, same
   ordered-steps-with-gates treatment, planned in full before Phase 1 execution starts.
5. `ARCHITECTURE.md` — the living guide to how the app is actually built: structure, patterns,
   conventions, updated as they change. `docs/adr/` holds the dated decision record behind it,
   one file per decision — see `docs/punch-list.md` for small one-off notes, and GitHub issues
   for real backlog.

## Data sources

Raw FPC exports (`collected_inks.csv`, `collected_pens.csv`, `currently_inked.csv`) and the
prototype color-clustering tooling that inspired the color-similarity feature (`gen_inks.py`,
already doing real CIE Lab + ΔE clustering) live at `~/Notes/personal/ink-collection/` — personal
data and standalone tooling, not part of this repo. Phase 1's FPC import script reads from there.

## Stack

Node.js + SvelteKit + SQLite + Drizzle ORM + `colorjs.io` + `sharp` + Zod + Vitest + Playwright.
Full reasoning in `docs/project-plan.md`.
