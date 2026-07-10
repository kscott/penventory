# Architecture

How Penventory is actually built, as of the current code. This is a living guide — update it
whenever something structural changes. The *why* behind these choices lives in `docs/adr/`, one
dated file per decision; this file states what's true now without re-deriving the reasoning.

## Layers

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

Stack: Node.js (`node:22-slim`) + SvelteKit + SQLite (`better-sqlite3`) + Drizzle ORM +
`colorjs.io` + `sharp` + Zod + Vitest + Playwright + `pino` + `prom-client`. See
[[docs/adr/2026-07-06-stack]].

## Operating rule: everything through the app's own UI

The deployed app must be fully operable through its own interface. No operation — import,
migration, backup, anything — may ever require shelling into the container or SSHing into the
host. A dev environment is for building and testing software, not for operating the finished
product. See [[docs/adr/2026-07-09-no-shell-ssh-operational-rule]].

Concretely: no CLI scripts (`npm run import:whatever`) exist for anything a user would do against
real data. Migrations apply automatically on container startup. Backups happen automatically
before a migration runs. See [[docs/adr/2026-07-09-no-cli-at-all-for-import]].

## Controlled lists: `resolveOrFlag`

Any field that's a proper name or open-ended category (brand, line, model, material, finish,
filling system, nib shape, vendor) is a foreign key into its own lookup table, resolved through
one shared function: `resolveOrFlag(type, name, scopeId?)` in `lib/server/db/resolve-or-flag.ts`.

Four outcomes, checked in order:
1. **Exact match** — resolves silently.
2. **Known alias** — resolves via the polymorphic `aliases` table (curated, not computed — e.g.
   "Namiki" → "Pilot").
3. **Fuzzy-flagged** — never auto-created. Two independent signals can trigger this: Damerau-
   Levenshtein similarity ≥ 0.7, or `containsAsWords` (every word of the shorter name appears, in
   order, in the longer one — catches "Pilot" vs. "Pilot Namiki", which fuzzy similarity alone
   misses).
4. **New** — no match by any signal; a genuinely new canonical row.

Unscoped tables (`brands`, `pen_materials`, `nib_materials`, `finishes`, `filling_systems`,
`nib_shapes`, `vendors`) have one canonical name globally. Scoped tables (`lines`, `models`) are
brand-scoped — two brands can each legitimately have a "Classic" line.

Both the FPC import and any future manual-entry UI call this same function, so the
no-silent-duplicate guarantee holds regardless of which caller is used. See
[[docs/adr/2026-07-08-duplicate-protection-shared-resolveorflag]] and
[[docs/adr/2026-07-09-resolveorflag-two-signals]].

**Not every fixed vocabulary goes through this machinery.** `nib_purities`, `nib_base_sizes`,
`nib_point_sizes` are real lookup tables (so adding a value is a data operation, not a deploy) but
are resolved exact-match-only — deliberately excluded from fuzzy/alias treatment, since real data
confirms values like "FM"/"MF"/"F/M" are genuinely distinct vendor conventions, not typos of each
other. See [[docs/adr/2026-07-09-nib-value-lookup-tables-not-enums]].

## Computed values are never stored twice

A value derived from other rows is computed at read time, never written redundantly to a column.
Examples: `used`/`swatched` (true once ≥1 `inkings` row references the ink/exists a photo), ink
`color` (lookup-hierarchy: swatch → colorimeter → fpc, unless `color_override_source` points
elsewhere). Raw source values (`color_fpc`, `color_swatch`, `color_colorimeter`,
`color_community`) stay independent, nullable-except-fpc columns — never blended into each other.
See [[docs/adr/2026-07-08-ink-color-four-fields-plus-computed]].

## `pen_nibs` vs. `inkings.nib_id`: independent facts

`pen_nibs` is formal install/removal history (structural, rarely touched). `inkings.nib_id` is an
independently-entered fact about what was actually used for a given inking session. The two are
never reconciled automatically — a test-fit doesn't force a permanent `pen_nibs` change. Display
rule: "current nib for this pen" prefers the most recent inking's `nib_id`, falling back to
`pen_nibs`'s open row only when the pen has no inkings yet. See
[[docs/adr/2026-07-09-pen-nibs-inkings-independent-facts]].

## Import: persisted as rows, never as a file

FPC catalog import and the color-refresh operation both persist their working state as
`import_attempts` + `import_flagged_items` rows — never a report file. Parsing creates one
`import_flagged_items` row per parsed CSV row, not only flagged ones (there's nowhere else the
parsed data could live between parse and commit, given the no-file rule) — `row_data` is a JSON
snapshot (raw CSV fields + `sourceLine`, the 1-indexed original line number), so a decision
survives even if the source CSV later changes.

**Every genuinely ambiguous field on a row gets its own decision, not just the first one found.**
A row can have more than one ambiguous field at once (a typo on `Brand` *and* on `Material`); each
is independently resolved via `field_decisions` (`Record<field, {decision, decisionTargetId}>`),
not a single row-level `decision`. `decision`/`decision_target_id` stay row-level for the cases
where there's genuinely only one judgment call: `possible_duplicate` (import-anyway or skip) and
unconditional `skip`. See [[docs/adr/2026-07-10-per-field-decisions-not-per-row]].

**A row that can't be resolved at all — a required field blank, or an unparseable `Nib` — is
correctable, not just skippable.** `row_data.raw` is editable JSON; a review UI can fix the value
directly, then `decision: 'import'` means "re-resolve now" — commit re-runs the real resolution
logic against whatever `row_data.raw` currently holds, refusing again if still broken, committing
cleanly if fixed, or re-flagging if the fix itself turns out ambiguous. `unparseable_row`'s
required-field set for pens: `Brand`, `Model`, `Color`, `Material`, `Trim Color`, `Filling
System` — every schema column with no safe default. `Nib` blank is a real, valid case (excluded);
`Date Added` blank falls back to the DB's own timestamp default rather than blocking the row. See
[[docs/adr/2026-07-10-unparseable-rows-are-correctable]].

Commit reads by attempt id and refuses if any item is undecided, including per-field. See
[[docs/adr/2026-07-09-no-cli-at-all-for-import]].

**A duplicate match, an unparseable nib, and a flagged field are independent signals — a row can
trip more than one at once**, since duplicate detection runs on raw composite-key text
(deliberately excluding `Nib`, which an already-committed pen has no raw text to reconstruct)
while field resolution and nib parsing are separate mechanisms entirely. `flag_type` picks one
"headline" reason for the review UI (`possible_duplicate` > `unparseable_nib` >
`needs_confirmation`, most consequential first), but `candidate_info` always carries every signal
that actually fired, and both `isItemFullyDecided` and commit's nib-reresolution path key off the
row's actual content, never off `flag_type` alone — otherwise a duplicate-flagged row with a
malformed `Nib` could commit silently with no nib and no error. See
[[docs/adr/2026-07-10-flag-signals-are-not-mutually-exclusive]].

## Testing

- No code path may require live external system state to be tested. If a dependency would
  introduce that requirement, the dependency is the wrong choice — rethought, not isolated behind
  a fake. See [[docs/adr/2026-07-08-no-live-external-state-in-tests]].
- Integration tests run against a real temp-file SQLite (`mkdtempSync` + `migrateDatabase`), not
  a fake or in-memory substitute — this is the standard pattern across `resolveOrFlag`, the
  repository layer, and import service tests alike.
- Vitest coverage gated at 90% minimum in CI, not just reported. See
  [[docs/adr/2026-07-08-coverage-threshold-90-percent]]. That's the CI gate, not the actual bar —
  every uncovered line in a coverage report gets read and either covered or given a specific,
  written reason, never silently accepted because the aggregate percentage already cleared 90%.
  Two real bugs (a non-functional existing-catalog duplicate check, a crash on an unrecognized nib
  base size) were found exactly this way, not by "tests pass." See
  [[docs/adr/2026-07-10-chase-coverage-gaps-to-100-percent]].
- Fixture CSVs are many small, targeted files (one per condition), never one monolithic file.

## Migrations

Authored explicitly (`drizzle-kit generate` → committed SQL, checked against a CI drift check) but
applied automatically on container startup — a deliberate contrast with import, which stays
Ken-triggered because it involves real-data dedup judgment calls made in the moment, not a change
already decided at commit time. A backup runs first only when there are pending migrations to
apply. See [[docs/adr/2026-07-08-schema-migrations-authored-explicit-applied-automatic]].

Every `integer(..., { mode: 'timestamp' })` column's default is `sql\`(unixepoch())\``, never
`CURRENT_TIMESTAMP` — the latter returns SQLite's human-readable TEXT format, which silently
becomes an Invalid Date under Drizzle's integer-timestamp mode. Found by a test that actually
called `.getTime()` on a default-populated timestamp instead of just checking it wasn't null. See
[[docs/adr/2026-07-10-timestamp-default-was-invalid-date]].

## Enum notation

Schema docs use `enum(...)` for any constrained-value field, never `string (...)` — the latter
reads identically to genuinely free-text fields. See
[[docs/adr/2026-07-08-enum-notation-not-string]].

## Where things live

- `docs/vision.md` / `docs/PRD.md` — product intent, source of truth for product decisions.
- `docs/project-plan.md` — original technical planning document. Will be archived once fully
  superseded by the built app; this file (`ARCHITECTURE.md`) is what stays current after that.
- `docs/phase*-plan.md` — ordered build steps per phase, gate per step.
- `docs/adr/` — one dated file per architectural decision, with full context and rationale.
- `docs/punch-list.md` — small one-off reminders. GitHub issues are the real backlog.

This file itself carries no dated entries and no todo list — see
[[docs/adr/2026-07-08-no-improvement-backlog-in-decision-log]].
