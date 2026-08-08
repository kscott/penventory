# Penventory — Phase 1.1 Plan: Import (web-based)

Inserted between Phase 1 and Phase 2, not appended as Phase 7 or squeezed into Phase 2/3 —
see `docs/adr/2026-07-09-import-gets-own-phase-1-1.md` and
`docs/adr/2026-07-09-no-cli-at-all-for-import.md` for why. Short version: the FPC import isn't actually
*done*, in any usable sense, until it's a real web feature. This phase builds the FPC importer
specifically — not a generic one; see
`docs/adr/2026-08-08-import-is-fpc-specific-for-now-generic-csv-is-future-state.md` for why that's a
deliberate, bounded choice and what the eventual generic-CSV/field-mapping state looks like. Phase 1 builds the
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

2. **Import routes: upload + parse, plus the upload screen itself.** Accepts **one** CSV per
   upload — `collected_pens.csv` or `collected_inks.csv`, never both required together — with its
   content type indicated explicitly by whoever's uploading, not inferred from the file's header.
   See `docs/adr/2026-08-08-import-is-fpc-specific-for-now-generic-csv-is-future-state.md`:
   explicit indication over sniffing is deliberate, both cheaper now and the right interaction
   shape once generic import exists later. Invokes Phase 1's service logic directly (no
   reimplementation), which creates the `import_attempts` + `import_flagged_items` rows exactly as
   Phase 1 designed them, scoped to that one entity type. Pens and inks are fully independent from
   here on — uploading one never requires or implies the other; each is its own attempt, worked
   through and committed on its own schedule. Worked out with Ken 2026-08-08 after review of the
   first cut of this UI surfaced the original two-file-required design as wrong.

   **Content-type registry**, `src/lib/shared/import-content-types.ts` — first file in
   `lib/shared/`: `IMPORT_CONTENT_TYPES` (`pens`/`inks` active, `inkings` — `currently_inked.csv`,
   Phase 4 — `coming_soon`; `nibs` deliberately excluded, see `docs/punch-list.md`'s loose-nib
   entry, its mechanism isn't decided), a flat `ImportContentType` key type (no separate
   compile-time "active" subtype — the `isActiveImportContentType` guard is the one place that
   decides what's usable right now, checked at the real boundary of a raw form string).

   **`import_attempts.content_type`** — new `NOT NULL` column, same enum-notation/no-DB-enforcement
   caveat as every other enum column in `schema.ts`. Set once, at creation, from the same validated
   value that also selects which parser runs; never inferred from parsed row data afterward (an
   attempt with zero parseable rows has nothing to infer from, and it gets the causality
   backwards — content type is a fact about the upload event, not a derived effect of parsing it).
   Never updated after creation.

   **`parseCatalogImport`** takes `{ csv, contentType }`, dispatching to
   `parsePensIntoAttempt`/`parseInksIntoAttempt` via a `CONTENT_PARSERS` lookup (only entries for
   what's implemented — a miss throws a clear error rather than being statically hidden).

   **One open attempt per content type, not per attempt overall.** Any number of *different*-type
   attempts can be open at once (pens and inks are fully independent domains), but duplicate
   detection only ever checks the real catalog and rows within the *same* attempt — never across
   two separate open attempts of the same type — so two simultaneous pens attempts could each
   introduce the same new pen and neither would catch it. `findOpenAttemptForContentType` backs
   this both in the upload UI (never offer starting a second one) and defensively in the upload
   action itself.

   **The upload screen**, on `/import` itself (not a separate route) — one row per registry entry,
   not a `<select>` (a disabled option can't carry a live link to the attempt it's blocking on):
   available (file input, submit), already-open (no file input, direct link into the existing
   attempt instead — never let Ken pick a file only to have it silently redirected away from),
   coming-soon (inert). Landed as a starting point to refine once it's an actual screen to react
   to, not settled further in the abstract — see the open question below.

   *Open, not yet resolved:* an already-open row here links to an attempt that's also sitting in
   the existing open-attempts list on the same page — overlapping information, two lists. Resolve
   during live review once it's on screen, not before.

   *Gate:* contract test for the upload/parse endpoint against fixture CSVs, covering both content
   types plus a rejected/unrecognized one; integration test asserting the `content_type` invariant
   directly (matches the value passed in, matches every child row's `row_data.entityType`);
   Playwright tests for the upload screen's three states, a successful upload landing on the new
   attempt's review page, and a second upload of an already-open type being refused.

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
       for processing at once — originally raised about color-refresh specifically, but pens/inks
       being fully independent uploads (2026-08-08, see step 2) makes it the normal case for
       catalog import too: a pens attempt and an inks attempt can sit open side by side, reviewed
       on separate schedules. Deliberately minimal — no pagination, filtering, or sorting; a
       single-user tool won't realistically need them yet.

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
