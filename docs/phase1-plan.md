# Penventory — Phase 1 Plan: Data layer + deferred infra

Covers the core catalog schema (brands/lines/pens/inks/nibs/tags), the FPC import's
underlying service logic — no CLI, tested directly, same pattern as every other
service in this phase — see `phase1.1-plan.md` for the real, deployed-usable web
feature built on top of it, and two Containerization items `project-plan.md` never
assigned a phase to (`/healthz`, `/metrics`). No ledger, no purchases, no photos yet —
those wait for the features that give them meaning (Phase 3/4).

Project-wide testing rules from `phase0-plan.md` still apply unchanged: 90% coverage
enforced in CI, no code path may require live external system state to test. Every
numbered step below is one issue/branch, closed before merge.

## Migrations — explicitly authored, verified in CI, auto-applied on startup

Drizzle's migration tooling (`drizzle-kit`) generates versioned SQL migration files
from schema diffs. Two different things both called "explicit" earlier in this
conversation turn out to need different answers — worth separating clearly:

- **Authoring a migration is explicit and CI-verified.** `drizzle-kit generate` diffs
  `lib/server/db/schema.ts` against the previous snapshot and writes a new SQL file to
  `drizzle/` — committed to git, human-readable, never generated at deploy time. A CI
  drift check (new addition to the `integration` job standing since Phase 0) runs
  `drizzle-kit generate` against a clean checkout and fails if it would produce a file
  not already committed — catches "changed the schema, forgot to generate/commit the
  migration" before it ships, same spirit as the lint gate applied to schema changes.
  Integration tests apply the real migration files (`migrate()` against a fresh
  temp-file SQLite before each suite), proving they apply cleanly from zero.
- **Applying an already-committed migration is automatic on startup — dev and
  production both.** When a new image deploys to the homelab, part of container
  startup is catching up on any pending migrations before serving traffic — standard
  practice for structural, tracked, idempotent changes (Drizzle only applies
  migrations that haven't run yet). This is different from the FPC import: a schema
  migration is authored, reviewed, and committed by a human well before it ever runs;
  applying it is just "catch the database up to code that's already been reviewed."
  The FPC import (§6 below) stays a deliberate, Ken-triggered action because it's
  mutating real collection data with dedup judgment calls attached in the moment, not
  applying a change that was already decided and reviewed at commit time.
- If there are pending migrations to apply, startup takes a backup first — same
  `sqlite3 <db-file> ".backup ..."` method as the import CLI — before applying them.
  Skipped on routine restarts with nothing pending, so it doesn't add overhead to
  every container start, only ones that actually change the schema.

## Ordered steps

1. **`/healthz` + `/metrics` routes.** Trivial SvelteKit routes; `prom-client` wired
   for default process metrics (`collectDefaultMetrics()`).
   *Gate:* `/healthz` — e2e smoke test asserts 200. `/metrics` — asserting 200 alone
   doesn't prove Prometheus could actually scrape it, so the gate checks the response
   is genuinely valid exposition format: `Content-Type` matches `prom-client`'s
   registry content type (`text/plain; version=0.0.4; charset=utf-8`), and the body
   contains recognizable `# HELP`/`# TYPE` lines plus at least one of the default
   Node process metrics (e.g. `process_cpu_user_seconds_total`) — proving the default
   collectors are actually registered, not just that the route returns something.
   **Not CI-testable, deferred to Phase 2:** there's no deployed host yet for a real
   Prometheus to scrape. Once Phase 2's GHCR/Portainer step lands the app on Quarto's
   network, adding the scrape job to Quarto's `prometheus.yml` and confirming via
   Prometheus's own `/targets` page (scrape succeeds, a query against one of the
   metric names returns data) is the real end-to-end proof — operational, verified via
   `/verify`, same pattern as the real FPC import and the GHCR/Portainer step itself.

2. **Schema: all controlled-list tables + `aliases`.** `drizzle-kit generate` (see
   Migrations above). Full field list and reasoning per table in `project-plan.md`'s
   "Controlled lists" section — summarized here:
   - `brands`, `lines` (brand-scoped), `models` (brand-scoped, pen equivalent of
     `lines` — added per vision.md's "applies to pens and inks both" line, which the
     schema originally left unimplemented for pens).
   - `pen_materials`, `nib_materials` — deliberately separate tables (different
     vocabularies: Acrylic/Ebonite vs. Gold/Steel/Titanium), same mechanism.
   - `finishes` (plating color — Gold-tone/Rhodium/Rose Gold/Black PVD — shared by
     `pens.trim_color_id` AND `nibs.finish_id`, one real-world vocabulary, not two
     lists), `filling_systems` — `filling_systems` isn't hypothetical: Ken's real FPC
     export already has three spellings of "Cartridge/Converter" and two of "Pump
     Filler," confirmed by direct inspection.
   - `nib_shapes` — merges what earlier drafts of this plan had as two separate
     fields (`tipping_type`, `grind_type`). Same underlying fact — "what shape is
     this tip" — regardless of whether it shipped that way, was a factory custom
     order, or was ground later by a third party.
   - `vendors` — merges what earlier drafts had as `purchases.vendor` (string) and
     `nibs.nibmeister` (string). A nibmeister is a vendor — someone paid for a
     service — and keeping them as separate free-text fields meant the same real
     business (e.g. "PenRealm" the shop / "Kirk Speer" the person who owns it and
     grinds nibs) could show up as two disconnected, unmatchable strings.
   - `aliases`: `id`, `alias`, `aliasable_type` (`brand` / `line` / `model` /
     `pen_material` / `nib_material` / `finish` / `filling_system` /
     `nib_shape` / `vendor`), `aliasable_id`, unique constraint on
     (`alias`, `aliasable_type`) — polymorphic, one table instead of nine
     near-identical per-type alias tables. Holds known alternate names with zero
     spelling similarity to the canonical value — "Namiki" for "Pilot," "Journaler"
     for the "Cursive Italic" nib shape — curated from Ken's own domain knowledge,
     never computed.
   - `import_runs` — audit log (`operation_type`, `mode`, `report_summary` json,
     `run_at`). The catalog import and color-refresh CLIs (steps 6/8 below) each
     write a row here at the end of every dry-run or commit — a real record of when
     each judgment-heavy operation last ran and what it did, not just nice-to-have
     given how much review goes into each one.
   *Gate:* integration test against a real temp-file SQLite instance (not a fake),
   migrated via the real generated migration file — asserts foreign key enforcement,
   the unique constraints, and alias→canonical resolution across all nine aliasable
   types. CI drift check passes (migration file matches what's committed).

3. **Repository: one shared `resolveOrFlag(type, name, scopeId?)` across all
   controlled-list tables.** Parametrized by entity type, not nine copy-pasted
   implementations (same "shared structure, not three copies" principle as Phase 4's
   `purchases` table). Brands/pen_materials/nib_materials/finishes/
   filling_systems/nib_shapes/vendors aren't scoped; lines and models are
   (`scopeId` = a `brand_id`, required for those two only). Four outcomes, checked
   in order — this is the actual fix for "a fat-fingered typo silently creates dirty
   data," which a UI alone can't guarantee against (a picker only helps if someone
   looks at it before submitting):
   1. **Exact match** (case-insensitive, whitespace-trimmed) on the canonical name →
      returns the existing row. "pilot" / " Pilot " → existing "Pilot".
   2. **Exact match on a known alias** → resolves to that alias's canonical row.
      "Namiki" → existing "Pilot", automatically, once the alias is on file.
   3. **Fuzzy-similar to an existing name, but no exact or alias match** → **does not
      create.** Returns the near-duplicate candidate(s) and forces the caller to
      explicitly decide before anything is written. "Piolt" against existing "Pilot"
      is flagged, never silently becomes a new row — same outcome whether it's one
      row typed by hand or one row in a 260-row import, because both paths call this
      same function rather than each implementing their own check.
   4. **No match at all, even fuzzy** → safe to create as genuinely new.

   The similarity-scoring logic in outcome 3 is a shared, pure, testable function
   (reused by step 6's bulk duplicate detection — one implementation of "is this a
   duplicate," not per-type copies). Phase 3 still has to design *how* the "possible
   duplicate, confirm?" signal surfaces in the actual manual-entry form — that's real
   UI work, not solved here — but the guarantee that a near-duplicate can never be
   silently created no longer depends on that UI being built well; it's already true
   at this layer.
   *Gate:* integration test covering all four outcomes across all nine types,
   including the specific regression cases: "Piolt" against seeded "Pilot" is
   flagged, not auto-created; "Namiki" against a seeded alias resolves directly to
   "Pilot", not flagged at all; a scoped near-duplicate (e.g. a `models` row) under
   one brand doesn't false-positive against a same-named row under a different
   brand (scoping is respected).

4. **Schema: `pens`, `inks`, `nibs`, `tags`/`taggables` (core fields only).** Another
   generated migration, same workflow as step 2. Full field lists in
   `project-plan.md`. The short version: every categorical field that used to be
   free text on `pens`/`inks`/`nibs` is now a foreign key into one of step 2's
   controlled-list tables (`material_id`, `trim_color_id`, `filling_system_id` on
   pens; `material_id`, `shape_id`, `finish_id`, `nibmeister_id` on nibs; `maker_id`
   on inks, reusing `brands` directly). `nibs.brand_id` and `pens.model_id` in particular fix
   two real bugs — both were free-text strings in earlier drafts of this schema,
   same class of bug, fixed the same way. `nibs.brand_id` is **nullable** — a bare
   point size in FPC's data (just "F"/"M"/"B", no other qualifiers) is a confirmed
   real case where the manufacturer genuinely isn't recorded. `purity_id`,
   `base_size_id`, and the newly added `point_size_id` on nibs are FKs into three
   new lookup tables (`nib_purities`, `nib_base_sizes`, `nib_point_sizes`) —
   **not** TypeScript enums, and **not** given fuzzy/alias treatment (not in
   `ALIASABLE_TYPES`): confirmed against Ken's real FPC data that "FM"/"MF"/"F/M"
   all coexist as genuinely distinct valid values (Pilot/Sailor/Diplomat
   conventions), not typos of each other — a fuzzy matcher would have actively
   mis-flagged them. Originally drafted as plain constrained strings, but that
   would mean a genuinely new value (a rare karat, an unusual housing size) could
   only ever be added by editing code and deploying — real friction for
   collector-world vocabularies Ken doesn't fully control. Real lookup tables
   fix that: seeded with the known values by this migration
   (`NIB_PURITY_SEED`/`NIB_BASE_SIZE_SEED`/`NIB_POINT_SIZE_SEED` in `schema.ts`),
   resolved by exact match only (found, or flagged for an explicit decision —
   never fuzzy-suggested, never silently created), so a new value afterward is
   a data operation, not a migration. See
   `docs/adr/2026-07-09-nib-value-lookup-tables-not-enums.md`
   for the full reasoning, and `phase3-plan.md` step 3 for how the live-entry
   "add new value" path surfaces once Nib CRUD exists. No `purchases`,
   `inkings`, `pen_nibs`, `used`, or `swatched` — see "Deferred columns" below.
   *Gate:* integration test creates one row per table, verifies every foreign key
   (including that `nibs.brand_id` accepts null) and the tag/taggable polymorphic
   join. CI drift check passes.

5. **Schema: `pen_nibs`. Repository: pens/inks/nibs/pen_nibs — read + raw create.**
   Full CRUD UI is Phase 3; a raw `create` is needed here only to support import.
   `pen_nibs` (`id`, `pen_id` → pens, `nib_id` → nibs, `installed_on`, `removed_on`
   nullable — null means currently installed, `notes`) is pulled forward from Phase 4
   specifically because step 6's import needs it: every imported pen's parsed stock
   nib becomes a real `nibs` row *and* a `pen_nibs` row linking the two, not just an
   orphaned nib sitting in the catalog. Phase 4 step 1 still builds the assign/remove
   UI and "current nib" query — this step only adds the schema plus a raw create/read,
   same scope discipline as pens/inks/nibs themselves. "Read" here means what step 6
   actually needs: get-by-id and list-all (for duplicate-detection scanning), not a
   general query layer — full querying is Phase 2/3's job.
   *Gate:* integration tests — one row created and read back per table (pens, inks,
   nibs, pen_nibs), including `pen_nibs.removed_on` accepting null (currently
   installed) and a non-null value (a closed install record), same pattern as step 4's
   FK/null coverage.

6. **FPC import — service logic only, no CLI.** Builds the parsing/`resolveOrFlag`/
   duplicate-detection/persistence/commit logic as framework-agnostic **service code**
   (`lib/server/services`, per the existing layered architecture — depends on step 5's
   repository interfaces, not Drizzle directly). **There is no CLI, not even for local
   testing** — the only human-facing interface for this feature is the browser, built
   in Phase 1.1 (see `docs/adr/2026-07-09-no-cli-at-all-for-import.md`
   — no shell, no SSH, no CLI, no hand-edited files, not even
   locally, not even temporarily). This step's tests call the service functions
   directly against a real temp-file SQLite (`mkdtempSync` + `migrateDatabase`) — the
   exact same pattern step 3's (`resolveOrFlag`) and step 5's (repository) tests
   already use, no subprocess, no argv parsing. **No real `db` client module needed
   here either** — that moves to **Phase 1.1 step 1**, the first point a genuinely
   persistent, long-running connection is actually needed (a running server checking
   real sessions against a real database), not this one. **Scoped to
   `collected_pens.csv` and `collected_inks.csv` only** — the catalog data.
   `currently_inked.csv` (FPC's historical inking ledger) is out of scope here and
   moves to Phase 4 — see `phase4-plan.md` step 5.

   **Persisted state is `import_attempts` + `import_flagged_items`, never a file.**
   Parsing creates one `import_attempts` row (`id`, `operation_type`
   enum(`catalog_import`/`color_refresh`), `status` enum(`open`/`committed`),
   `created_at`, `committed_at` nullable) and one `import_flagged_items` row per row
   needing a decision (`id`, `import_attempt_id` → import_attempts, `row_data` json —
   a snapshot of the parsed row, so a decision survives even if the source CSV later
   changes, `flag_type` enum(`needs_confirmation_brand`/`needs_confirmation_line`/
   `needs_confirmation_model`/`possible_duplicate`/`unparseable_nib`), `candidate_info`
   json nullable — match candidate id/name/similarity where applicable, `decision`
   enum(`import`/`skip`/`merge_into`/`alias_to`) nullable, `decision_target_id`
   integer nullable — the id for `merge_into`/`alias_to`, `decided_at` timestamp
   nullable). Phase 1.1's review/decide UI and this step's own tests both work
   directly against these tables through the same service functions — nothing is
   ever written to or read from a file.

   **Identity, confirmed against the real export files** (not assumed): FPC's CSVs
   carry no per-record ID at all.
   - Inks (`Brand;Line;Name;Type;Color;...`): natural key is the Brand+Line+Name+Type
     tuple.
   - Pens (`Brand;Model;Nib;Color;Material;Trim Color;...`): natural key is
     Brand+Model+Nib+Color+Material+Trim.
   - Confirmed by inspecting Ken's actual files (260 ink rows, 282 pen rows) — no ID
     column exists in either. Ken's own existing prototype (`import_inks.py` in
     `~/Notes/personal/ink-collection/`) sidesteps this by dropping and recreating the
     whole table on every run; that approach doesn't transfer here, since Penventory
     attaches real ledger/tag/purchase data to catalog rows that a wipe-and-reload
     would orphan.

   **Every pen row creates a linked `nibs` row too, via `pen_nibs`** — not just the
   `pens` row alone. A pen's stock nib is a first-class `nibs` row from acquisition
   (`pen_nibs` schema lives in step 5 above, pulled forward from Phase 4 for exactly
   this reason), so the import has to parse FPC's free-text `Nib` column into the
   structured fields it actually represents. Confirmed by inspecting
   the real distribution across all 282 rows, this one column smashes together up to
   five distinct facts with no consistent delimiter (`"M #8 Titanium Cursive Smooth
   Italic"` = point size + base size + material + shape, all in one string) — not
   safely parseable by a generic regex, but genuinely parseable against **Ken's own
   confirmed entry conventions**, not a guessed-at general hobby vocabulary:
   - A **blank** `Nib` value means no nib for that pen — a real, confirmed case (Ken
     has bought pen bodies without one), not an error to reject.
   - A **bare point size alone** ("F"/"M"/"B", no other qualifiers) means: material =
     Steel, `base_size` = #6, `brand_id` = left null (genuinely not recorded — JoWo
     vs. Bock vs. other isn't knowable from this data). `shape_id` defaults to Round.
   - Recognized tokens get extracted directly: point size against the confirmed
     constrained set, `#N` against `base_size`, `NK` against `purity`, known shape
     keywords against `nib_shapes` (including aliases — "Journaler" resolves to
     canonical shape "Cursive Italic" the same way "Namiki" resolves to "Pilot").
     Whatever's left over after known tokens are stripped becomes `custom_name`.
   - Anything that doesn't cleanly decompose this way — an unrecognized token, or
     something that looks like an entry error rather than a real value (confirmed
     example from the real data: "sF," which doesn't match any known point size and
     isn't a recognized abbreviation) — becomes its own `import_flagged_items` row
     (`flag_type = unparseable_nib`), same mechanism as the brand/duplicate flags,
     for Ken to resolve through Phase 1.1's UI, not a silent best guess.
   - **Finish/color confirmed real** — "Black," "Rose Gold" etc. in the raw data are
     plating color, distinct from base material. Parsed against `finishes` (the same
     controlled list `pens.trim_color_id` uses) into `nibs.finish_id`.

   Two operations:
   - **Parse (creates the attempt).** Parses the CSVs and runs step 3's
     `resolveOrFlag` for every Brand, Line, and Model value (collapses spelling
     drift, e.g. "Pilot" / "PILOT" / "Pilot Namiki" → one canonical brand; checks
     known aliases first, e.g. "Namiki" → "Pilot" resolves automatically once that
     alias exists), then runs **duplicate detection** on the full row (Brand+Line+
     Name+Type for inks, Brand+Model+Nib+Color+Material+Trim for pens) for whatever's
     left unresolved — both within the batch being imported and against whatever's
     already in the database. Matching is fuzzy, not exact-key-only — "mistakes
     happen, data isn't always clean," so exact-match alone would miss real
     duplicates and near-miss typos both. Same similarity-scoring function step 3
     uses — one implementation, not per-field copies. Writes one `import_attempts`
     row plus one `import_flagged_items` row per row categorized as needs-
     confirmation (brand, line, or model) or possible-duplicate (each paired with
     its match candidate and similarity score in `candidate_info`) — `decision` left
     `null` on every one. Nothing is auto-resolved; nothing here writes to the
     catalog tables yet.
   - **Commit (`commitImportAttempt(attemptId)`).** Refuses if any
     `import_flagged_items` row under that attempt still has `decision = null`.
     Takes a backup first, automatically — `sqlite3 <db-file> ".backup ..."`
     (WAL-safe, same method `project-plan.md`'s Containerization section specifies)
     — before writing anything. Writes the catalog rows via step 5's repository,
     marks the attempt `committed`. This is Ken's real collection data, worth
     protecting regardless of which environment it's loaded into; the auto-backup
     exists so that isn't something Ken has to remember to do by hand every time.

   Tested against small, **deliberately narrow, checked-in fixture CSVs** at
   `tests/fixtures/fpc-export/{pens,inks}/` — one file per specific condition
   (exact-duplicate, near-duplicate typo, brand-drift, known-alias, the `Nib`-column
   cases: blank/bare-point-size/full-compound/malformed-token, finish-as-plating-
   color) rather than one monolithic file, so a failing test points at exactly which
   condition broke. This is a starting list, not exhaustive — expect it to grow.
   Fictionalized per the standing fixture rule: invented brand/product names
   reproducing the real drift patterns, real controlled vocabulary reused as-is.
   Not Ken's live export — this is how "no live external state" holds here: the
   import logic never needs the real file to pass CI.
   For testing the commit path specifically, a test writes decisions directly into
   `import_flagged_items` rows — standing in for what Phase 1.1's UI will eventually
   do — then calls `commitImportAttempt` and asserts the result; no human
   interaction is needed since the fixture's correct outcome is already known.
   Every parse and commit writes a row to `import_runs` (operation_type=
   catalog_import) — a lightweight summary, not the full attempt state, so there's a
   queryable history of when imports ran and what they did.
   *Gate:* unit tests for parsing/duplicate-detection/similarity-scoring against
   fixtures (known expected categorization per file); integration test for the
   parse-then-commit path against a real temp-file SQLite, including the refusal
   case (any flagged item with `decision = null` → commit rejected), the
   backup-file-created assertion, and the `import_runs` row being written.

7. **FPC import — Ken's real run happens in Phase 1.1, not here.** There is no path to
   real, human-reviewed data in Phase 1 at all — no CLI exists, and reviewing/deciding
   on flagged items is real work on real data, which per the standing rule only ever
   happens through the app's own UI. Phase 1's job is to prove the service logic
   correct against fixtures; it has no mechanism, CLI or otherwise, for Ken to import
   his actual collection, even locally, even temporarily. That capability doesn't
   exist until Phase 1.1's authenticated review/decide UI ships — see
   `phase1.1-plan.md`. **Explicitly outside Phase 1's CI-gated definition of done**
   either way: the phase is done once the service logic exists and passes its
   fixture-based tests, not once real data has been imported anywhere.
   *Gate:* none — nothing is built by this step; it exists to state a boundary, not
   produce an artifact.

   *Deferred to Phase 4:* importing `currently_inked.csv`'s historical inking records
   — see `phase4-plan.md` step 5 for the full reasoning (fuzzy-matching reconstructed
   description strings back against the by-then-populated catalog — a real matching
   problem in its own right, not a trivial join).

8. **FPC color refresh — a separate, narrower operation from the main import.** Same
   service-logic-only treatment as step 6 — no CLI, tested directly against fixtures,
   persists to `import_attempts`/`import_flagged_items` exactly like the main import.
   Real review-and-approve of an actual diff is also real work on real data — Phase
   1.1 wraps this in its own authenticated route once it matters for real; nothing
   here gives Ken an early, CLI-based way to run it against his real export. FPC's own
   `color` value is itself crowdsourced across all its users' entries and can
   legitimately change over time — it isn't a fixed fact Ken's import captures once
   and forgets. A distinct operation, update-only:
   - Matches each CSV row against **existing** ink rows using the same natural-key
     matching as the main import — but never creates a new row. An unmatched row
     becomes an `import_flagged_items` row (`flag_type = unmatched_color_refresh`,
     `decision` nullable) since it genuinely needs a call (skip it, or it's a sign
     the natural key drifted and needs a manual look); a matched row with a changed
     `color_fpc` is unambiguous (apply it or don't) and doesn't need its own
     per-row decision — the diff is shown in the UI, and committing the attempt
     itself is the approval.
   - Commit updates only `color_fpc` on matched rows. Everything else on that ink
     (notes, tags, ledger entries, `color_swatch`, `color_colorimeter`,
     `color_override_source`) is untouched. Same backup-first discipline as the main
     import.
   - Ink-only — `pens.color` is FPC's resin/material *name* (a label), not a
     measured value, so this refresh concept doesn't apply there.
   - Same `import_runs` logging as the main import (operation_type=color_refresh).
   *Gate:* unit tests for the diff-report logic against fixture CSVs (changed value,
   unchanged value, unmatched row); integration test for the commit path asserting
   only `color_fpc` changes on a matched row, nothing else on that ink is touched,
   and the `import_runs` row is written.

9. **Ink field-by-field completeness review — the same rigor step 6's pens half already
   got, never yet applied to the ink half.** Confirmed after the fact (2026-07-13): the
   pens side of step 6 went through a real post-merge completeness review (issue #15)
   that read every field against Ken's actual `collected_pens.csv` directly rather than
   trusting this document's assumptions, and found genuine bugs doing it — a
   non-functional duplicate check, a crash on an unrecognized nib value, an
   extraction-order bug, several real domain facts (Signature/Zoom/Music/CM/Journaler/
   Scribe/Imperial/Seagull/Long Knife/Flex/Hongdian) that needed hand-confirming with
   Ken rather than guessing. None of that ever happened for inks. This step is that
   review, scoped to `collected_inks.csv` and the ink half of `fpc-import.ts`.

   **Method, unchanged from the pens review — apply it fresh, don't assume ink mirrors
   pens:**
   - One column at a time: `Brand`, `Line`, `Name`, `Type`, `Color`, `Swabbed`, `Used`,
     `Comment`, `Private Comment`, `Private`, `Archived`, `Archived On`, `Usage`,
     `Tags`, `Date Added`, `Maker`, `Daily Usage`, `Last Usage`. Verify every
     "required"/"ignored"/"combined" assumption below against the real file directly —
     temporary, parse-only, never-commit, delete-after-use, same convention the pens
     review used (see `docs/adr/2026-07-13-nib-shape-material-finish-vocabulary-is-pre-seeded.md`
     for the pattern). The findings below are a confirmed starting point from one such
     pass (2026-07-13, 259 real rows), not the final word — re-verify, don't just trust
     this list.
   - Two bug classes the nib review found do **not** apply here, confirmed by reading
     the code, not assumed — worth stating explicitly so this review doesn't waste time
     chasing them: (a) the empty-vocabulary-bootstrap problem (a parser doing its own
     phrase-matching before a value ever reaches `resolveOrFlag`, so a genuinely new
     word is never offered as a "new value" candidate) doesn't exist for inks — every
     ink field (`Brand`/`Line`/`Name`/`Type`/`Maker`) resolves straight from raw CSV
     text into `resolveOrFlag` with no pre-filtering step, the same way pens'
     `Brand`/`Material`/`Trim Color` already safely do; (b) the extraction-order bug
     (multiple facts smashed into one free-text column, parsed out in a
     category-dependent sequence) doesn't apply either — ink's CSV already has each
     fact in its own column, unlike `Nib`.
   - Chase every coverage gap individually once new code lands here, same standard as
     the rest of this project: 90% is the CI floor, 100% is the real bar unless a gap
     has a written, verifiable reason (see
     `docs/adr/2026-07-10-chase-coverage-gaps-to-100-percent.md`).

   **Confirmed real findings from the 2026-07-13 pass — concrete, not hypothetical,
   each with what it takes to close it:**
   - **No required-field validation exists for inks at all — a real, unguarded gap.**
     Pens have `PEN_REQUIRED_FIELDS` + `blankRequiredFields`, producing a clean
     `unparseable_row` flag for a blank `Brand`/`Model`/`Color`/`Material`/`Filling
     System`. Inks have no equivalent: a blank `Brand`/`Name`/`Type`/`Color` currently
     flows straight into `resolveOrFlag`/direct field assignment with an empty string —
     `resolveOrFlag(db, 'brand', '')` would silently create a nonsense empty-string
     brand row instead of ever being flagged, and `name: ''`/`type: ''` would silently
     write invalid data to `NOT NULL` columns with no error at all. Ken's real
     `collected_inks.csv` happens to have zero blanks across `Brand`/`Name`/`Type`/
     `Color` today (confirmed directly), so this hasn't bitten him yet — the code has
     no guard regardless. **Resolve by** adding an `INK_REQUIRED_FIELDS` constant and
     wiring the same `blankRequiredFields` check into the ink parse loop pens already
     use — read `inks`' actual `.notNull()` columns in `schema.ts` as the ground truth
     for what belongs in the set, don't guess from this list.
   - **Ink's `unparseable_row` correction path is a stub, not a gap in disguise —
     it's real, unimplemented code.** `resolveRowForCommit` in `fpc-import.ts` throws
     `"ink unparseable_row correction isn't implemented yet"` outright whenever
     `originalEntityType !== 'pen'`. Only reachable once the point above exists (nothing
     currently produces an ink-side `unparseable_row` to correct). **Resolve by**
     mirroring pens' correction path: re-run ink field resolution against the corrected
     `row_data.raw`, re-flag in place (same row id) if the correction is itself still
     ambiguous, commit cleanly if fixed — exact same shape as
     `docs/adr/2026-07-10-unparseable-rows-are-correctable.md` already describes for
     pens.
   - **`Type` is cast, never validated — the same class of bug the nib base-size crash
     was, just not yet triggered.** `type: rowData.type as (typeof
     schema.INK_TYPES)[number]` at commit time is a bare TypeScript cast with zero
     runtime check. `INK_TYPES`'s Drizzle `enum` option is not database-enforced (no
     `CHECK` constraint — confirmed the same way the nib-purities/base-sizes finding
     was: Drizzle's SQLite `enum` emits a plain `text` column). A genuinely invalid
     `Type` value in the CSV would silently write garbage into a supposedly-constrained
     column — no crash, no flag, nothing. Ken's real data only ever has `bottle`/
     `sample` (confirmed directly; `cartridge` never appears once) — clean today by
     luck, not by design. **Resolve by** deciding, the same way the
     nib-value-lookup-tables-not-enums ADR already had to for purity/base-size/point-size:
     is `Type` a closed set worth a hard validation error on mismatch (it's exactly
     three fixed values, not an open collector vocabulary the way nib purity is), or
     does it need its own flagged-review path? Almost certainly the former — resolve
     with Ken before assuming either way.
   - **`Tags` is completely unparsed — a large, real gap, not an edge case.** Confirmed
     directly: 189 of 259 real rows (73%) have non-blank `Tags`, comma-separated free
     text (`"reserved, smalt blue"`, `"azure, janelle"`, `"gifted"`). Nothing in
     `fpc-import.ts` reads this column at all, even though the polymorphic
     `tags`/`taggables` schema (step 4) already exists and already supports inks.
     **Resolve by** splitting on comma (confirmed real delimiter; verify no other
     separator convention appears anywhere in the real file before assuming comma is
     the only one), trimming each piece, and creating (or reusing, exact-match only —
     confirm with Ken whether tag names should ever get `resolveOrFlag`-style
     fuzzy/alias treatment the way brand names do, or whether that's overkill for
     informal free-text labels) a `tags` row plus a `taggables` row per tag per ink.
   - **`Private` (boolean) is ignored, and there's no schema column for it at all.**
     Real data: always `false` across all 259 rows — zero real signal either way in
     Ken's own export. **Resolve by** asking Ken directly whether this is deliberately
     out of scope (reads like FPC's own community-sharing privacy flag, which may not
     mean anything in a single-user app) or a real gap worth a schema column — don't
     guess given zero real evidence to reason from.
   - **`Swabbed`/`Used`/`Usage`/`Daily Usage`/`Last Usage` are FPC-computed historical
     stats with nowhere to land, same already-settled pattern as pens' analogous FPC
     stats.** Real signal exists (`Swabbed`: 212 true / 47 false; `Used`: 140 / 119) but
     `inks.swatched`/`inks.used` are explicitly computed columns — derived from
     `inkings`/`photos`, neither of which exists until Phase 3/4 (see "Deferred
     columns" below). These historical true/false facts have no home in Phase 1's
     schema. **Resolve by** confirming with Ken whether the raw snapshot is worth
     preserving as a note (a point-in-time fact: "FPC said used=true as of the export
     date") or is accepted as fully lost, matching pens' "Penventory's real ledgers
     replace FPC's computed stats" design — don't assume either answer without asking,
     since unlike pens this wasn't explicitly discussed for inks.
   - **`Comment`/`Private Comment` currently collapse into one undifferentiated
     `notes` field — a decision that's never actually been exercised against real
     content.** Current code joins both (blank-line separated) whenever non-blank.
     Real data: `Private Comment` is blank in all 259 rows (zero real signal to verify
     the collapsing behavior against); `Comment` has 16 non-blank rows. Given `Private
     Comment` was presumably meant to pair with the `Private` flag above (a hidden
     tier), collapsing them into one field may be conflating two different privacy
     intents that were never actually tested. **Resolve by** confirming with Ken
     whether single-user Penventory has any real "private from whom" concept worth a
     separate field, or whether one `notes` field is genuinely fine — tied to the
     `Private` decision above, resolve them together.
   - **The `Brand|Line|Type` duplicate-identity key has never been independently
     challenged the way pens' original key was.** Pens' key survived a real redesign
     after contact with real data (Filling System excluded, resolved-ids not raw text —
     see `docs/adr/2026-07-10-identity-key-is-resolved-not-raw-text.md`). Ink's key was
     "designed during the pens-driven redesign but never independently questioned."
     **Resolve by** asking the same skeptical questions pens' key got: does `Type`
     really belong (two entries with the literal same `Brand`+`Line`+`Name` but
     different `Type` — a bottle and a sample of the same ink — legitimately distinct,
     or the same ink counted twice)? Does `Maker` ever belong? Run the real ~260-row
     file through it and see whether it survives contact the way pens' redesigned key
     did.

   *Gate:* same shape as step 6's — unit tests for the new/changed parsing logic
   against fixtures (one fixture per condition, fictionalized ink/pen identity, real
   controlled vocabulary reused as-is — same standing rule the nib review's fixtures
   already follow); integration tests for the parse-then-commit path proving each
   resolved gap above (required-field validation, `unparseable_row` correction, `Type`
   validation, `Tags` import, whatever `Private`/`Comment` decisions land) end-to-end
   against a real temp-file SQLite; a real-file diagnostic re-run (temporary,
   parse-only, never-commit, deleted after use) confirming the numbers hold up against
   Ken's actual `collected_inks.csv`, same as the nib review's final check. Coverage
   back to 100% (or every gap individually justified) once this step's code lands.

## Deferred columns — why, and where they actually land

`project-plan.md`'s ink schema lists `used` and `swatched` as if present from day one.
They can't be — both are computed:
- `used` is true once ≥1 `inkings` row exists → `inkings` doesn't exist until
  **Phase 4**.
- `swatched` is true once a swatch photo/composite exists → `photos` doesn't exist
  until **Phase 3**.

Each column is added by its own migration in the phase where its dependency actually
lands — not stubbed in early with a default that would drift out of sync with nothing
backing it.

Same logic for `purchases`: a relationship/history table that only means something
once its owning feature (purchase tracking) exists — Phase 4, not here.

`pen_nibs` is the exception, pulled forward into **step 5**: unlike `purchases`, the
FPC import (step 6) needs it *now* to link an imported pen to the `nibs` row parsed
from its stock nib — not deferred to whatever phase gives it a UI. Phase 4 step 1
builds the assign/remove flow and "current nib" query on top of this already-existing
schema; it doesn't create the table. See
`docs/adr/2026-07-09-pen-nibs-pulled-forward-to-phase1.md`.

## Definition of done

`brands`/`lines`/`models`/`aliases`/`pens`/`inks`/`nibs`/`pen_nibs`/`tags`/`import_runs`/
`import_attempts`/`import_flagged_items` schema exists, generated via `drizzle-kit` with
the migration files committed and CI's drift check green. The FPC import **service
logic** exists (catalog import and the separate color-refresh mode both) and is tested
directly against fixture CSVs — **no CLI, no way for Ken to import real data anywhere,
even locally**, since reviewing/deciding on flagged items is real work on real data and
per the standing rule that only ever happens through the app's UI (see
`docs/adr/2026-07-09-no-cli-at-all-for-import.md`). Real import
capability is entirely **Phase 1.1's** definition of done, not this phase's — Phase 1
only has to prove the underlying logic works against fixtures. `/healthz` and `/metrics`
live. All gates above green in CI (lint, typecheck, unit+coverage ≥90%, integration —
now including the migration drift check, e2e smoke, Docker build — same jobs Phase 0
stood up, no new pipeline stages).
