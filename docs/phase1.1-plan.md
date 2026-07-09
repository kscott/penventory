# Penventory — Phase 1.1 Plan: Import (web-based)

Inserted between Phase 1 and Phase 2, not appended as Phase 7 or squeezed into Phase 2/3 —
see `ARCHITECTURE.md`'s 2026-07-09 entries for why. Short version: the FPC import isn't actually
*done*, in any usable sense, until it's a real authenticated web feature. Phase 1 builds the
underlying parsing/`resolveOrFlag`/duplicate-detection **service logic** and proves it out via a
local CLI test harness — that CLI is a development/testing tool, never a production path (the
project's standing rule: the deployed app must be fully operable through its own interface, zero
operations ever requiring an operator to shell into the container or SSH into the host). This
phase is what actually makes real-data import possible on the deployed instance: auth, then a
route + UI wrapping Phase 1's service logic, reused rather than reimplemented.

Named `1.1`, not renumbering Phases 2–6 up by one — a pure file-rename-and-fix-every-cross-
reference cascade for no information gain. It sits here, before Phase 2, because Phase 2 (Visual
browse) already assumes real pen/ink data exists by the time it starts.

Project-wide testing rules from `phase0-plan.md` still apply unchanged: 90% coverage enforced in
CI, no code path may require live external system state to test. Every numbered step below is one
issue/branch, closed before merge.

## Ordered steps

1. **Auth: `users`/`sessions`, session-cookie middleware.** Minimal by design — exactly one user,
   ever, manually seeded (no registration flow, no password reset, no multi-user anything).
   `users: id, username, password_hash, created_at`; `sessions: id, user_id → users,
   session_token (unique), expires_at, created_at`. A `hooks.server.ts` gate protects every route
   from here forward — nothing ships web-reachable without the session check already in place,
   even behind Tailscale's private-network boundary.
   *Gate:* unit tests for session creation/validation/expiry; integration test against a real
   temp-file SQLite; contract test asserting an unauthenticated request to a protected route is
   rejected.

2. **Import routes: upload + dry-run.** Accepts the two CSVs (`collected_pens.csv`,
   `collected_inks.csv`) via an authenticated route, invokes Phase 1's service logic directly (no
   reimplementation — same parsing/`resolveOrFlag`/duplicate-detection functions the CLI test
   harness already exercises), returns the dry-run report as structured JSON for the UI to render.
   *Gate:* contract test for the upload/dry-run endpoint against fixture CSVs (same fixtures
   Phase 1's unit tests use); asserts an unauthenticated request is rejected.

3. **Review/decide UI.** Renders the dry-run report — new / needs-confirmation / possible-
   duplicate rows — and lets Ken record a decision on each flagged item (`import` / `skip` /
   `merge-into:<id>` / `alias-to:<type>:<id>`) directly in the browser. Replaces Phase 1's
   hand-edited `import-report.json` file as the actual mechanism Ken uses; the report *format*
   doesn't change, just how decisions get attached to it.
   *Gate:* Playwright test driving the full review flow against a fixture dry-run report — flag a
   possible-duplicate, record a decision, assert it's reflected before commit is enabled.

4. **Commit route.** Refuses without every flagged row decided (same refusal rule as Phase 1's
   CLI commit path). Takes the automatic WAL-safe backup first. Writes via Phase 1 step 5's
   repository. Logs `import_runs`.
   *Gate:* integration test for the commit path against a real temp-file SQLite, including the
   refusal case, the backup-file-created assertion, and the `import_runs` row; contract test for
   the route itself.

5. **Color-refresh — same treatment.** Authenticated route wrapping Phase 1's color-refresh
   service logic (diff report → review → commit), same reasoning as steps 2–4: the CLI version
   proves the logic out, this is what makes it usable on the deployed instance.
   *Gate:* contract test for the diff-report endpoint; integration test for the commit path
   (matched-only, `color_fpc` the only field touched).

## Definition of done

Auth exists and gates every route. The full import workflow — upload, dry-run, review/decide,
commit — is reachable and usable entirely through the browser, with zero shell/SSH access to the
deployed instance required at any point. Same for color-refresh. All gates above green in CI.
