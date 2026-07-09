# Penventory — Phase 1 Plan: Data layer + deferred infra

Covers the core catalog schema (brands/lines/pens/inks/nibs/tags), the FPC import, and
two Containerization items `project-plan.md` never assigned a phase to (`/healthz`,
`/metrics`). No ledger, no purchases, no photos yet — those wait for the features that
give them meaning (Phase 3/4).

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
   a data operation, not a migration. See `ARCHITECTURE.md`'s 2026-07-09 entry
   for the full reasoning, and `phase3-plan.md` step 3 for how the live-entry
   "add new value" path surfaces once Nib CRUD exists. No `purchases`,
   `inkings`, `pen_nibs`, `used`, or `swatched` — see "Deferred columns" below.
   *Gate:* integration test creates one row per table, verifies every foreign key
   (including that `nibs.brand_id` accepts null) and the tag/taggable polymorphic
   join. CI drift check passes.

5. **Repository: pens/inks/nibs — read + raw create.** Full CRUD UI is Phase 3; a raw
   `create` is needed here only to support import.
   *Gate:* integration tests.

6. **FPC import CLI.** A command Ken runs himself, whenever he has a fresh export ready
   — pointed at whatever file he chooses at that moment
   (`npm run import:fpc -- --pens <path> --inks <path>`), not a fixed one-time event
   executed while working through this phase. **Scoped to `collected_pens.csv` and
   `collected_inks.csv` only** — the catalog data. `currently_inked.csv` (FPC's
   historical inking ledger) is out of scope here and moves to Phase 4 (see note
   below): it depends on the `inkings` table, which doesn't exist yet.

   **This is also where the real `db` client module finally gets built.** Every
   repository test through step 5 constructs its own temp-file SQLite inline
   (`schema.integration.test.ts`, `resolve-or-flag.integration.test.ts` —
   `mkdtempSync` + `migrateDatabase`, torn down after each test) — proving schema and
   repository logic, never proving the production wiring. This CLI is the first thing
   that has to open a *real* database file from a *real* `DATABASE_URL` and actually
   do something to it (read the existing catalog, write new rows, take a backup), so
   it's also where `src/lib/server/db/client.ts` (deleted as premature scope back in
   step 2 — zero consumers at that point) gets built for real: reads `DATABASE_URL`,
   opens the `better-sqlite3` connection, runs the existing `migrateDatabase` against
   it — same function the integration tests already use, just pointed at a real file
   path instead of a `mkdtempSync` one.
   *Gate (in addition to the CLI gate below):* an e2e-level test — not another
   temp-file integration test — that points `DATABASE_URL` at a real file path,
   goes through the client module's actual construction path (not a hand-rolled
   `Database`/`migrateDatabase` pair built directly in the test), and confirms a
   genuine, working connection comes back. This proves the env-var-to-connection
   wiring itself, which the repository-level integration tests never exercise.

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
   (see `phase4-plan.md` step 1), so the import has to parse FPC's free-text `Nib`
   column into the structured fields it actually represents. Confirmed by inspecting
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
     isn't a recognized abbreviation) — goes into the same review report as the
     brand/duplicate flags, for Ken to resolve by hand, not a silent best guess.
   - **Finish/color confirmed real** — "Black," "Rose Gold" etc. in the raw data are
     plating color, distinct from base material. Parsed against `finishes` (the same
     controlled list `pens.trim_color_id` uses) into `nibs.finish_id`.

   Two passes:
   - **Dry-run (default, no DB writes).** Parses the CSVs and runs step 3's
     `resolveOrFlag` for every Brand, Line, and Model value (collapses spelling
     drift, e.g. "Pilot" / "PILOT" / "Pilot Namiki" → one canonical brand; checks
     known aliases first, e.g. "Namiki" → "Pilot" resolves automatically once that
     alias exists), then runs **duplicate detection** on the full row (Brand+Line+
     Name+Type for inks, Brand+Model+Nib+Color+Material+Trim for pens) for whatever's
     left unresolved — both within the batch being imported and against whatever's
     already in the database. Matching is fuzzy, not exact-key-only — "mistakes
     happen, data isn't always clean," so exact-match alone would miss real
     duplicates and near-miss typos both. Same similarity-scoring function step 3
     uses — one implementation, not per-field copies. Writes a review report
     (`import-report.json`): every row categorized as new / needs-confirmation
     (brand, line, or model) / possible-duplicate (each flagged item paired with its
     match candidate and similarity score). Nothing is auto-resolved — every flagged
     item needs an explicit decision from Ken recorded back into the report before a
     commit run will accept it: `import` (genuinely new) / `skip` /
     `merge-into:<id>` (this row is a duplicate of an existing catalog entry) /
     `alias-to:<type>:<id>` (this value isn't a duplicate or a typo — it's a known
     alternate name, like "Namiki" for brand "Pilot" — resolve to the given
     brand/line/model **and** write a new `aliases` row, so the same name resolves
     automatically next time, without Ken having to catch it again).
   - **Commit (`--commit --report <reviewed-report>`).** Refuses to run without a
     reviewed report where every flagged row has a decision. Takes a backup first,
     automatically — `sqlite3 <db-file> ".backup ..."` (WAL-safe, same method
     `project-plan.md`'s Containerization section specifies) — before writing anything.
     This is Ken's real collection data, worth protecting regardless of which
     environment it's loaded into; the auto-backup exists so that isn't something Ken
     has to remember to do by hand every time.

   Tested against small **checked-in fixture CSVs** at `tests/fixtures/fpc-export/` —
   deliberately including exact-duplicate, near-duplicate (typo/spacing), and
   brand-drift cases — not Ken's live export. This is how "no live external state"
   holds here: the import logic never needs the real file to pass CI.
   Every dry-run and commit writes a row to `import_runs` (operation_type=
   catalog_import) — the report summary, not the full report file, so there's a
   queryable history of when imports ran and what they did.
   *Gate:* unit tests for normalization and duplicate-detection/similarity-scoring
   (fixture cases with known expected categorization); integration test for the
   commit-from-reviewed-report path against a real temp-file SQLite, including the
   refusal case (unreviewed flagged row → commit rejected), the backup-file-created
   assertion, and the `import_runs` row being written.

7. **FPC import — Ken's real run.** Not executed by Claude as part of this phase —
   entirely Ken's call, on his own schedule, against whatever export he currently has.
   Dry-run first, review the report (including duplicate candidates), record decisions,
   then commit. Explicitly **outside Phase 1's CI-gated definition of done** — the
   phase is done once the CLI exists and passes its fixture-based tests; populating
   real data is a deliberate action Ken takes when he's ready, not a checkbox on the
   way to closing this phase.

   **What this does and doesn't touch:** whatever runs during Phase 1 (Ken's own Mac,
   in a local dev/test setup) is not the real deployment — that's the homelab instance
   (Secondo), stood up later per `project-plan.md`'s Infrastructure section. The SQLite
   file itself is never part of the app's build/deploy artifact in either environment —
   it's a path pointing at a persistent volume that exists independently of the app
   image (`project-plan.md`'s Volumes section already establishes this). Nothing about
   this CLI, or any future app install/update, creates, resets, or touches that volume
   except through an explicit, Ken-initiated run like this one.
   *Gate:* none from this plan — `/verify` is Ken's own judgment call on his own data,
   whenever he runs it.

   *Deferred to Phase 4:* importing `currently_inked.csv`'s historical inking records.
   Its `Pen`/`Ink` columns don't reference catalog rows by ID either — they're
   reconstructed description strings (e.g. `Pelikan Souverän M800, Transparent Green,
   Acrylic, Gold, B 18K` for a pen, `Pilot Iroshizuku Kon-peki - bottle` for an ink) that
   have to be fuzzy-matched back against the by-then-populated catalog. That's a real
   matching problem in its own right, not a trivial join — worth calling out now so it
   isn't underestimated when Phase 4 gets there.

8. **FPC color refresh — a separate, narrower operation from the main import.** FPC's
   own `color` value is itself crowdsourced across all its users' entries and can
   legitimately change over time — it isn't a fixed fact Ken's import captures once
   and forgets. A distinct mode on the same CLI
   (`npm run import:fpc -- refresh-color --inks <path>`), update-only:
   - Matches each CSV row against **existing** ink rows using the same natural-key
     matching as the main import — but never creates a new row. An unmatched row is
     skipped/flagged, not treated as new.
   - Dry-run produces a **diff report** — ink X, old `color_fpc` → new `color_fpc` —
     for every row where FPC's value actually changed. Nothing is applied blind.
   - `--commit` updates only `color_fpc` on matched rows. Everything else on that ink
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

Same logic for `pen_nibs` and `purchases`: both are relationship/history tables that
only mean something once their owning feature (nib assignment, purchase tracking)
exists — Phase 4, not here.

## Definition of done

`brands`/`lines`/`models`/`aliases`/`pens`/`inks`/`nibs`/`tags`/`import_runs` schema
exists, generated via `drizzle-kit` with the migration files committed and CI's drift
check green. The FPC
import CLI exists (catalog import and the separate color-refresh mode both), is tested
against fixture CSVs, and is ready for Ken to run against his real export whenever he
chooses — **actually populating real data is not part of this phase's done-ness**, it's
a separate action on Ken's own schedule. `/healthz` and `/metrics` live. All gates above
green in CI (lint, typecheck, unit+coverage ≥90%, integration — now including the
migration drift check, e2e smoke, Docker build — same jobs Phase 0 stood up, no new
pipeline stages).
