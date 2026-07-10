# CI hardening: `any`-type ban, warning gates, dependency/image/code scanning

**Status:** Accepted

**Context:**
Grouped batch, own issue (#10), separate from any phase-plan step since it's tooling, not
feature work.

**Decision:**
- `@typescript-eslint/no-explicit-any` promoted from `warn` to `error`; `npm run lint` runs
  `eslint . --max-warnings 0` so no warning-level rule silently passes CI. Ken's direct ask —
  explicit `any` should never land.
- Same gap fixed on the typecheck side: `svelte-check` reports Svelte's own compiler-level a11y
  warnings but exits 0 regardless by default (confirmed live — a bare `<img>` triggers
  `a11y_missing_attribute`). Fixed with `--fail-on-warnings` on the `check` script.
- New `audit` CI job: `npm audit --omit=dev --audit-level=high`. `--omit=dev` excludes
  devDependency-only findings; `--audit-level=high` excludes a low-severity finding pinned
  upstream by SvelteKit itself.
- GitHub repo settings enabled directly via `gh api`: secret scanning + push protection,
  Dependabot security updates (security only, no routine version-update noise), CodeQL default
  setup, `allow_auto_merge`.
- New `dependabot-auto-merge.yml` workflow, matching GitHub's current documented example
  (verified live, not from training data). Auto-merges patch/minor Dependabot PRs by squash once
  CI is green; major-version bumps still wait for a human.
- New `docker` job step: `aquasecurity/trivy-action@v0.36.0` scans the built image for
  CRITICAL/HIGH OS-level and library CVEs — closes the gap `npm audit` leaves (it only covers npm
  packages, not `node:22-slim`'s own OS packages).

**Consequences:**
- Trivy's first real run caught two HIGH CVEs on the first try (CVE-2026-33671,
  CVE-2026-48815), both traced to npm's own bundled internal dependencies
  (`usr/local/lib/node_modules/npm/node_modules/{picomatch,sigstore}`), not the app's. Root cause:
  `node:22-slim` ships npm/corepack/yarn in every stage, but the runtime stage's
  `CMD ["node", "build/index.js"]` never calls any of them. Fixed by removing
  `/usr/local/lib/node_modules/{npm,corepack}`, `/opt/yarn-v*`, and their bin symlinks from the
  runtime stage — eliminates the CVEs by removing what carries them, not by chasing version
  bumps. Verified the stripped image still builds, runs, and serves `/healthz`/`/metrics`/`/` at
  200.
- Both current `npm audit` findings dismissed as GitHub Dependabot alerts too via `gh api`
  (`not_used` for the dev-only `esbuild` issue, `tolerable_risk` for the SvelteKit-pinned
  `cookie` issue) — stops notification noise for findings that aren't fixable from this repo; a
  genuinely new advisory on either package still alerts normally.
