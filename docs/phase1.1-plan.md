# Penventory — Phase 1.1 Plan: Import (web-based)

Inserted between Phase 1 and Phase 2, not appended as Phase 7 or squeezed into Phase 2/3 —
see `docs/adr/2026-07-09-import-gets-own-phase-1-1.md` and
`docs/adr/2026-07-09-no-cli-at-all-for-import.md` for why. Short version: the FPC import isn't actually
*done*, in any usable sense, until it's a real web feature. Phase 1 builds the
underlying parsing/`resolveOrFlag`/duplicate-detection **service logic** and proves it out with
direct unit/integration tests — no CLI at all, not even for local testing (same pattern every
other service in this codebase already uses). This phase is what actually makes real-data import
possible, full stop: **there is no CLI, no shell, no SSH, no hand-edited file — the only way any
real decision on real data ever gets made is through this UI.** The real `db` client module, then
upload, then this review/decide UI, wrapping Phase 1's service logic directly rather than
reimplementing it. No auth — see
`docs/adr/2026-08-03-auth-dropped-tailscale-is-the-only-gate.md`; Tailscale is the only access
gate for this single-user product.

Named `1.1`, not renumbering Phases 2–6 up by one — a pure file-rename-and-fix-every-cross-
reference cascade for no information gain. It sits here, before Phase 2, because Phase 2 (Visual
browse) already assumes real pen/ink data exists by the time it starts.

Project-wide testing rules from `phase0-plan.md` still apply unchanged: 90% coverage enforced in
CI, no code path may require live external system state to test. Every numbered step below is one
issue/branch, closed before merge.

## Ordered steps

1. **The real `db` client module.** `src/lib/server/db/client.ts` gets built for real — not Phase
   1, since nothing there ever touched a non-temp-file database. Import routes are the first thing
   that needs a genuine persistent `DATABASE_URL` connection: reads `DATABASE_URL`, opens the
   `better-sqlite3` connection, runs the existing `migrateDatabase` against it — same function
   every integration test already uses, just pointed at a real file path instead of a
   `mkdtempSync` one. No auth, no session gate — see
   `docs/adr/2026-08-03-auth-dropped-tailscale-is-the-only-gate.md`.
   *Gate:* an e2e-level test for the client module's actual construction path against a real file
   path, proving the env-var-to-connection wiring itself.

2. **Import routes: upload + parse.** Accepts the two CSVs (`collected_pens.csv`,
   `collected_inks.csv`) via a route, invokes Phase 1's service logic directly (no
   reimplementation — the same parsing/`resolveOrFlag`/duplicate-detection functions Phase 1's
   tests already exercise directly), which creates the `import_attempts` + `import_flagged_items`
   rows exactly as Phase 1 designed them. Returns the new attempt's id/state to the UI.
   *Gate:* contract test for the upload/parse endpoint against fixture CSVs (same fixtures Phase
   1's unit tests use).

3. **Review/decide UI.** Renders an attempt's `import_flagged_items` and lets Ken record a
   decision on each directly in the browser, written straight to that item's row the moment it's
   made — no batch save, no intermediate file, resumable at any point since nothing is lost
   between decisions. Split into sub-steps (3a/3b/3c, not renumbered as separate top-level steps —
   same non-renumbering convention as Phase 1.1 itself) since the four flagged-row types don't
   share one UI shape: the two candidate-picking types share more with each other than with the
   two correction types, and building all four at once risked a large PR with nothing landing.
   Decided with Ken 2026-08-04.

   3a. **`possible_duplicate`, a minimal open-attempts index, and — the real foundation of this
       step — generic per-row editing.** Confirmed with Ken 2026-08-04: any raw field on any
       flagged row (not just the field that triggered the flag) needs to be editable — corrected,
       filled in if blank, or cleared if it shouldn't have been there — with the row re-evaluated
       against current data afterward, for every flag type, not just `unparseable_row`/
       `unparseable_nib`. Editing is optional and never auto-resolves a row by itself: a
       possible_duplicate that's still a duplicate after editing (or resolves into a *different*
       flag type — fixing a Brand typo could turn it into `needs_confirmation`) still needs an
       explicit decision. A row that comes back genuinely clean behaves exactly like a
       never-flagged row already does (auto-`decision: 'import'`), not a new special case.

       This is real new service-layer work, not just UI: a generic re-evaluation function,
       callable interactively (not just at commit time the way `resolveRowForCommit`'s two
       existing special cases work today) — re-run full field resolution for the row's entity type
       (pen or ink) against the corrected `row_data.raw`, re-check duplicates against both the real
       catalog *and* every other still-pending item in the same attempt (sourced from their
       already-persisted `row_data`, not re-resolved), determine the new flag (or clear it), and
       update the item in place (mirrors the re-flag-updates-the-original-row pattern commit-time
       correction already uses). Nearly every low-level piece already exists and is reusable
       (`resolvePenFields`/`resolveInkFields`, `buildPenRowData`/`buildInkRowData`,
       `penIdentityGroupKey`/`inkIdentityGroupKey`, `findDuplicateMatches`, `determineFlag`) — this
       is orchestration, not new resolution logic.

       On top of that: possible_duplicate's own row-level decision (`import`/`skip`) — the
       simplest decision shape, and the plan's own original gate example — and `/import`, a flat
       list of every non-`committed` `import_attempt` across operation types (not locked to
       `catalog_import` — step 5's color-refresh attempts belong here too), linking into each
       attempt's review page. Added 2026-08-04: Ken flagged that an attempt has no way to be found
       again without remembering its URL/id by hand, and separately wants multiple files staged up
       for processing at once (color-refresh especially). Deliberately minimal — no pagination,
       filtering, or sorting; a single-user tool won't realistically need them yet.

       *Gate:* unit/integration tests for the re-evaluation function directly (edit clears a
       duplicate match; edit turns a duplicate into a different flag type; edit fills a blank
       required field; edit clears a previously-populated optional field; a fully-clean
       re-evaluation auto-decides `import`) — independent of any UI, same as Phase 1's own
       parse/commit logic. Playwright test for the review page — flag a possible-duplicate, edit a
       field and confirm re-evaluation is reflected, record a decision, assert it's persisted,
       assert the commit-enabled indicator flips once every item in the attempt is decided.
       Separate Playwright test for `/import`: create two attempts, assert both are listed and
       link to their own review page, assert a committed attempt drops off the list.

   3b. **`needs_confirmation`.** Per-field decisions (brand/line/model/nib_* — every field named in
       `candidate_info.fields`/`nibValueFlags`), each independently `import`/`merge_into`/
       `alias_to` against its own candidate list (similarity/reasons shown per candidate).
       *Gate:* Playwright test covering a row with two independently-flagged fields, each decided
       differently, both persisted.

   3c. **`unparseable_nib` and `unparseable_row` correction UI.** Both need the same shape: show
       the raw offending value(s) (`Nib` text, or the missing/invalid required fields), let Ken
       edit `row_data.raw` inline, then decide `import` (re-resolve) or `skip`.
       *Gate:* Playwright test for each type — correct the raw value, decide import, assert the
       correction round-trips through re-resolution (may re-flag as a different type, per
       `resolveRowForCommit` — assert that's reflected too, not silently swallowed).

4. **Commit route.** Refuses if any `import_flagged_items` row under the attempt still has
   `decision = null` (same refusal rule Phase 1's tests already assert against the service
   function directly). Takes the automatic WAL-safe backup first. Writes via Phase 1 step 5's
   repository. Marks the attempt `committed`. Logs `import_runs`.
   *Gate:* integration test for the commit path against a real temp-file SQLite, including the
   refusal case, the backup-file-created assertion, and the `import_runs` row; contract test for
   the route itself.

5. **Color-refresh — same treatment.** A route wrapping Phase 1's color-refresh
   service logic (parse/diff → review → commit against `import_attempts`/`import_flagged_items`),
   same reasoning as steps 2–4: no CLI-based shortcut ever existed for this, either.
   *Gate:* contract test for the parse/diff endpoint; integration test for the commit path
   (matched-only, `color_fpc` the only field touched).

## Definition of done

The full import workflow — upload, parse, review/decide, commit — is reachable and usable
entirely through the browser, with zero shell/SSH/CLI access required at any point, for anyone,
ever. Same for color-refresh. All gates above green in CI.
