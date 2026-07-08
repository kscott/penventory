# Penventory — Phase 0 Plan

Setup only — no product code exists at the end of this phase beyond a base shell. Everything
here is infrastructure: the point is that testing/lint/CI/coverage discipline is proven out
*before* a single Pen/Ink/Nib model exists, per `project-plan.md`'s testing-discipline section.

## Project-wide testing rules (not just Phase 0)

- Coverage via Vitest's built-in reporting (`@vitest/coverage-v8`), **90% minimum threshold
  enforced in CI** — the build fails below it. May raise later; won't lower.
- **No code path may require live external system state to be tested.** If a future dependency
  would introduce that requirement, the dependency choice is wrong and gets rethought — it does
  not get isolated behind a fake, it does not get included. (Contrast with get-clear, where the
  EventKit/Contacts framework boundary genuinely can't run in CI without a live Mac — Penventory's
  stack has no equivalent boundary by design: SQLite, `sharp`, `colorjs.io`, and SvelteKit routes
  all run in-process with no live external dependency.)

## Ordered steps

1. **Repo init** — `~/dev/penventory/`, `git init`, `.gitignore`, docs moved in.
   *Gate:* none yet — nothing to test.

2. **SvelteKit scaffold + TypeScript strict mode.**
   *Gate:* `svelte-check` passes clean with zero errors.

3. **ESLint (typescript-eslint) + Prettier.**
   *Gate:* `npm run lint` clean. Standing gate from here forward — every later step keeps it green.

4. **Vitest config + one trivial passing unit test + coverage wired at 90% threshold.**
   *Gate:* the trivial test passes; coverage report generates. Threshold enforcement becomes a
   CI check in step 7, not just a local run — coverage is a visible number from commit 1, not
   bolted on later.

5. **Playwright config + one trivial smoke test** (loads `/`, asserts something trivial).
   *Gate:* a real browser drives against a running dev server, end-to-end. This is the same
   harness Phase 2's shuffle-animation tests depend on later — has to be solid now.

6. **Dockerfile** — multi-stage, `node:22-slim` runtime, non-root user.
   *Gate:* `docker build` succeeds locally; becomes a CI job in step 7.

7. **GitHub Actions CI workflow** — jobs: lint, typecheck, unit+coverage (90% gate), integration
   (placeholder job — no DB yet, so Phase 1 adds tests into an existing job rather than standing
   up a new one), e2e smoke, docker build.
   *Gate:* this step **is** the definition of done for the whole phase. Every job from steps 2–6
   has to show up here, green, before Phase 0 is considered finished.

8. **Base SvelteKit shell** — layout + nav, no data-driven content.
   *Gate:* the one step with visible UI, so it gets a Playwright test (nav renders, responsive at
   one breakpoint) folded into the existing e2e suite from step 7 — not a new test type. No
   unit/integration tests needed since there's no logic yet.

## Definition of done

CI green on every job — lint, typecheck, unit+coverage (≥90%), integration placeholder, e2e
smoke, Docker build — with zero product code beyond the shell. Matches `project-plan.md`'s line:
"all of the above green before any real feature exists."
