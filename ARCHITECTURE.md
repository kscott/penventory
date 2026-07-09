# Architecture — Decision Log

Current structure and the running record of decisions made. Update this whenever something
structural changes: new file, new type, extracted function. Decisions only — not a todo list.
Something noticed but not yet decided gets a GitHub issue, not an entry here; an entry lands
once there's an actual decision to record. This document is how continuity holds across
sessions.

## Decision log

**2026-07-06 — Stack.** Node.js (`node:22-slim`) + SvelteKit + SQLite + Drizzle ORM + `colorjs.io`
+ `sharp` + Zod + Vitest + Playwright + `pino` + `prom-client`. Full reasoning per layer in
`docs/project-plan.md`'s Stack table. Rails was the original plan (see old project-plan, now
superseded) — replaced after the vision/PRD revision session made the visuals-first, animation-
heavy browse experience (`animate:flip`) the actual point of the app.

**2026-07-06 — Layered architecture.** `routes/` → `lib/server/services/` → `lib/server/db/` +
`lib/shared/`. Routes stay HTTP-only so services can be unit-tested without spinning up the app,
and repositories can be swapped for fakes without touching real SQLite.

**2026-07-08 — Coverage threshold: 90%, enforced in CI.** Vitest + `@vitest/coverage-v8`. Not
just reported — the build fails below it. May raise later; starting point, not a ceiling.

**2026-07-08 — No code path may require live external system state to be tested.** Stronger than
"isolate it behind a fake" — if a dependency would introduce that requirement, the dependency is
the wrong choice and gets rethought, full stop. Named explicitly against get-clear's EventKit/
Contacts boundary, which genuinely can't run in CI without a live Mac. Penventory's stack has no
equivalent: SQLite runs in-process and is tested against a real instance (not a fake), `sharp`
and `colorjs.io` are pure library calls, SvelteKit routes are thin HTTP wrappers.

**2026-07-08 — Docs live in the repo, not in Notes.** `docs/vision.md`, `docs/PRD.md`,
`docs/project-plan.md`, `docs/phase0-plan.md` moved from `~/Notes/personal/ink-collection/` into
this repo's `docs/`. Rationale: project documentation belongs with the code it describes,
versioned alongside it. Raw FPC export data and the prototype color-clustering scripts
(`gen_inks.py` and friends) stay in Notes — personal source data and standalone tooling, not
project documentation, and not superseded by this repo existing.

**2026-07-08 — Dev workflow: one-issue-one-branch, close before merge.** Same process as
get-clear. Single-user doesn't mean less rigor.

**2026-07-08 — Phases 1–6 planned in full before any code beyond Phase 0.** Ken wanted to see
how the build upholds the stated principles before writing product code. Produced
`docs/phase1-plan.md` through `docs/phase6-plan.md` (ordered steps, gate per step, same
treatment `phase0-plan.md` got), expanding `project-plan.md`'s paragraph-level phase
descriptions. Filled several gaps `project-plan.md` left open:
- `/healthz` + `/metrics` (Containerization wanted both, no phase said when) → start of
  Phase 1, since Phase 0 is frozen.
- GHCR push + Portainer `secondo/personal-apps` stack wiring (described, not scheduled) →
  start of Phase 2, the first phase producing something worth running.
- `used`/`swatched` computed ink columns, listed in the schema as if present from Phase 1 —
  actually added by migration in Phase 4/Phase 3 respectively, once their dependency
  (`inkings`/`photos`) exists. Same reasoning applies to `pen_nibs` and `purchases` (Phase 4).
- New `ai_suggestion_logs` table (Phase 5) — makes "AI-derived content stays strictly
  separate from what Ken enters" a concrete, queryable fact rather than an unenforced policy.

**2026-07-08 — Local container runtime: `apple/container`, not OrbStack/Docker Desktop.**
Phase 0 step 6 needed something to verify `docker build` locally on this Mac (no runtime was
installed at all). Tried OrbStack first (brew cask) — works, but its onboarding defaults to a
Pro trial banner, an unnecessary licensing question for what's just a dev-loop build check.
Switched to Apple's own `container` CLI (`brew install container`, v1.1.0): Apache 2.0, fully
open source, no license tier at all, and it's the native fit for this Mac (Apple Silicon +
macOS 26 Tahoe, both already true here). It's OCI-compatible — builds/runs the same Dockerfile,
pulls/pushes the same registries — so nothing about the Dockerfile or CI (which still runs
`docker build` on GitHub-hosted Ubuntu runners, unchanged) depends on this choice. One
networking difference worth knowing: each container gets its own routable IP on a private
subnet rather than Docker's NAT+localhost port-publish — `container run -p` didn't map to
`localhost` in testing; hitting the container's own IP (`container list` shows it) worked.

**2026-07-08 — Claude accesses Penventory via a Zod-validated HTTP API, not a skill.**
Resolves the vision doc's explicitly-open question about the technical shape of Claude's
access. The app itself never calls an LLM — Claude-the-agent is the sole consumer/reasoner
over the API. Decided at Phase 5 planning because it's load-bearing: it's what keeps every
Phase 5 service unit-testable with zero live external dependency, per the "no code path may
require live external system state to test" rule above. Full detail in `docs/phase5-plan.md`.

**2026-07-08 — FPC import is a Ken-triggered CLI with dry-run review, not something Claude
runs.** Corrects an earlier draft of `phase1-plan.md` that had the real import as a step
Claude executes while working through Phase 1. Ken's call: he provides the export file, on
his own schedule, and controls whether/what gets committed. Concretely: a dry-run pass parses
+ normalizes + runs duplicate detection and writes a review report; nothing writes to the
database until Ken's reviewed every flagged row and re-runs with `--commit`, which takes an
automatic pre-write backup. Populating real data is explicitly outside each phase's CI-gated
definition of done.

**2026-07-08 — FPC import identity is fuzzy, not ID-based — confirmed against the real
export.** Checked Ken's actual `collected_inks.csv`/`collected_pens.csv` (260/282 rows): no
per-record ID exists in either. Natural keys are composite (Brand+Line+Name+Type for inks,
Brand+Model+Nib+Color+Material+Trim for pens), so duplicate detection has to be
similarity-scored, not exact-match — "mistakes happen, data isn't always clean" (Ken).
Ken's existing prototype (`import_inks.py`) avoids this by dropping and recreating its table
every run; that doesn't transfer to Penventory, since real ledger/tag/purchase data gets
attached to catalog rows that a wipe-and-reload would orphan. Same fuzzy-matching problem
recurs harder in Phase 4: `currently_inked.csv` cross-references pens/inks by a reconstructed
description string, not an ID — deferred there since it needs the catalog and `inkings` table
both to exist first. See `docs/phase1-plan.md` step 6 and `docs/phase4-plan.md` step 5.

**2026-07-08 — The SQLite database file is never part of the deploy artifact, in any
environment.** Restates `project-plan.md`'s existing Volumes design as an explicit hard rule
now that import tooling depends on it: the DB path always points at a persistent volume that
exists independently of the app image. No install or update — local dev, or the eventual
homelab deployment — creates, resets, or touches it except through an explicit, Ken-initiated
action like the import CLI. Local Mac/container work during development is not the real
production instance; that's the homelab deployment, stood up later.

**2026-07-08 — Schema migrations: authored explicitly, verified in CI, applied
automatically on startup.** Two different senses of "explicit" needed different answers.
Authoring is explicit and gated: `drizzle-kit generate` produces committed SQL files, and a
new CI drift check (folded into the `integration` job) fails if the schema changed without a
corresponding committed migration. Applying an already-committed, already-reviewed migration
is automatic on container startup (dev and the eventual homelab deployment both) — standard
practice for structural, tracked, idempotent changes, and a deliberate contrast with the FPC
import: that stays Ken-triggered because it's real data with dedup judgment calls made in the
moment, not a change that was already decided at commit time. Startup takes a backup first
only when there are pending migrations to apply, not on every routine restart. Full detail in
`docs/phase1-plan.md`'s Migrations section.

**2026-07-08 — `models` table added for pens; `nibs.brand` and `pens.model` fixed to foreign
keys.** Two real bugs found by cross-checking the schema against vision.md and against the
"fat-fingered duplicate" discussion: (1) `nibs.brand` was a free-text string, not a foreign key
to `brands` like pens and inks have — same spelling-drift risk, no reason for the
inconsistency, fixed. (2) `pens.model` was free text with no controlled list at all, even
though vision.md explicitly says Line-style controlled lists "apply to pens and inks both" —
`project-plan.md`'s original schema never implemented that for pens. Added a `models` table
(brand-scoped, same shape as `lines`) and `pens.model_id` as a foreign key to it.

**2026-07-08 — Brand/Line/Model duplicate protection lives in a shared repository function,
not the UI.** A near-duplicate ("Piolt" vs. "Pilot") can't be allowed to silently create a new
row just because a picker UI existed and nobody happened to look at it — "a fat-fingered typo
will go into the system and give us dirty data... we can't rely on progressive exposure being
sufficient" (Ken). Fix: one shared `resolveOrFlag(type, name, brandId?)` function, parametrized
across brand/line/model rather than three copies, with four outcomes checked in order — exact
match, known-alias match, fuzzy-similar (flagged, never auto-created), or genuinely new. Both
the bulk FPC import and any future manual-entry UI call the same function, so the guarantee
holds regardless of whether the UI is well-designed. Known-alias resolution (e.g. "Namiki" →
"Pilot", a real-world sub-brand name with zero string similarity to "Pilot" — not something any
similarity algorithm could infer) uses a new polymorphic `aliases` table (same pattern as
`taggables`/`purchases`), curated from Ken's own domain knowledge, not computed. Full detail in
`docs/phase1-plan.md` steps 2-3 and 6.

**2026-07-08 — Controlled-list treatment extended from brand/line/model to five more fields:
`pen_materials`, `nib_materials`, `finishes`, `filling_systems`, `nib_shapes`, `vendors`.**
Same drift problem, same mechanism (`resolveOrFlag` + `aliases`), applied wherever a field is a
proper name or open-ended category rather than a small closed set. Concretely proven, not
theoretical: Ken's own real FPC export already has three spellings of "Cartridge/Converter" and
two of "Pump Filler" in `filling_system`, found by direct inspection. `nib_shapes` merges what
would have been two separate fields (`tipping_type`, `grind_type`) — same underlying fact ("what
shape is this tip") regardless of whether it shipped that way, was a factory custom order, or
was ground later. `vendors` merges `purchases.vendor` and `nibs.nibmeister` — a nibmeister is a
vendor (paid for a service), and keeping them separate meant one real business (Kirk Speer /
PenRealm) could show up as two disconnected, unmatchable strings. `pen_materials` and
`nib_materials` stay separate tables despite both being called "material" — different
vocabularies (Acrylic/Ebonite vs. Gold/Steel/Titanium) sharing one mechanism, not one table.

**2026-07-08 — Not everything with a fixed vocabulary needs the controlled-list machinery.**
`purity`, `base_size`, and `point_size` on `nibs` stay plain constrained values (Zod enum/check
constraint), not controlled-list tables — small, stable, standardized vocabularies where the
fuzzy-matching machinery would do active harm. Concrete proof: `point_size`'s real data has
"FM", "MF", and "F/M" as three genuinely distinct, valid values (Pilot/Sailor/Diplomat's own
conventions for a similar concept), not a typo cluster — a fuzzy matcher would have wrongly
flagged them as near-duplicates of each other. Lesson generalized: string similarity alone
doesn't distinguish "typo of the same thing" from "different vendors' names for adjacent but
distinct things" — that distinction needs domain knowledge (Ken's), which is exactly why the
constrained-value fields stay simple rather than growing the same fuzzy machinery everywhere.

**2026-07-08 — Nibs are first-class from pen acquisition, tracked as history, not overwritten.**
A pen's stock nib is a real `nibs` row from the moment it's acquired (not a placeholder), linked
via `pen_nibs` (install/remove dates). Swapping in a custom nib closes the stock nib's
`pen_nibs` row and opens a new one for the replacement — the stock nib keeps its full history
and becomes a nib with no currently-open `pen_nibs` row (a loose nib in storage, exactly the
case Phase 6's not-yet-designed nib-location tracking is meant to help find). Corrected an
earlier, wrong assumption that `inkings.nib_id` being null meant "the stock nib" — that
stops being well-defined the moment a swap happens; the real source of truth for "what nib was
in this pen on this date" is `pen_nibs`'s history, not a null check on a different table.
`nibs.brand_id` is nullable for the same reason `point_size` needed real-data grounding: a bare
point size in FPC's data ("F"/"M"/"B" alone) is a confirmed real case where the manufacturer
genuinely isn't recorded (Steel, base_size #6, brand unknown) — not a gap to force-fill.

**2026-07-08 — Performance notes and end-reason are discrete boolean columns, not an enum or
free text.** Vision doc explicitly calls these "checkboxes" (plural — a cleaning could involve
*both* "ran dry" and "ink issue" at once), and the original schema had neither structured: a
single `end_reason` string (forces one choice, silently discards whichever reason didn't "win")
and a single `performance_notes` text blob (checkboxes existed only as a code comment, not real
columns — reporting on any of it would mean unreliable string-matching against prose). Fixed to
separate boolean columns per checkbox (`ended_ran_dry`, `ended_disliked`, `ended_needed_pen`,
`ended_ink_issue`; `flow_good`, `dry_time_good`, `feathering_observed`, `sheen_observed`), plus
one freeform text field alongside each group for anything the checkboxes don't capture. Full
detail in `docs/phase4-plan.md` step 4.

**2026-07-08 — `finishes` (renamed from `trim_colors`) is shared by pens and nibs.** Nib finish
(Black PVD, Rose Gold, etc. — confirmed real, distinct from base material) is the same
real-world vocabulary as a pen's trim color, not a separate concept. `pens.trim_color_id` and
`nibs.finish_id` both point at one `finishes` table — same reuse pattern as `maker_id` →
`brands` and `nibmeister_id` → `vendors`, rather than a fourth near-identical controlled list.

**2026-07-08 — Ink color is four independent stored fields plus one computed "effective" value,
not one field that gets overwritten.** Corrected an earlier draft that would have copied FPC's
value into a general-purpose `color` field at import time. Ken's objection: FPC's own color
value is itself crowdsourced across all its users and can legitimately change over time — "FPC
lives in FPC," never silently blended into another field. Fixed: `color_fpc`, `color_swatch`,
`color_colorimeter`, `color_community` are four independent, nullable-except-fpc stored values;
`color_override_source` is Ken's explicit pointer at which one is authoritative for a specific
ink (this is what "corrected hex" actually is — a pointer, not a fifth stored value); `color`
itself is COMPUTED at read time by a lookup-hierarchy service, never stored or duplicated — same
pattern already used for `used`/`swatched`/`color_family`. Default precedence when nothing is
manually overridden: swatch → colorimeter → fpc. `color_fpc` gets its own explicit, narrow
refresh operation (`phase1-plan.md` step 8) — matched-only, diff-reviewed, updates only that one
field — since re-syncing a legitimately-changed FPC value is a different, safer operation than
the main import's create-new-rows path. `color_colorimeter` is populated by an import of
`colorimeter.csv`, scheduled to **Phase 4** (not Phase 3) — it reuses the more refined
match/diff/review pattern established by then rather than a one-off Phase 3 bolt-on.

**2026-07-08 — `observations.inking_id` confirmed: one table for standalone notes and "Mid-use"
notes both.** Resolves the vision doc's third lifecycle moment (Start/Mid-use/End) that had no
home. `subject_type`/`subject_id` and `inking_id` are mutually exclusive on a given row — an
inking-attached observation doesn't need its own subject reference, since the inking it's
attached to already implies which pen/ink/nib it's about. Multiple observations can attach to
one inking over its life.

**2026-07-08 — Constrained-value fields use `enum(...)` notation, not `string (...)`.** The
latter read identically to genuinely free-text fields (`notes`, `custom_name`) and caused real
confusion (Ken: "the string designation confuses"). Applied across every constrained field in
`project-plan.md` — `size_category`, `condition`, `ownership_state`, `purity`, `base_size`,
`point_size`, `type`, `sheen`, `shading`, and all polymorphic type-discriminator columns
(`purchasable_type`, `subject_type`, `owner_type`, `kind`, `aliasable_type`, `taggable_type`,
`intent`). `feedback`, nib `wetness`, ink `wetness`/`flow`/`dry_time` all resolved to
`enum(high / medium / low)` — spelled out in full, not "H/M/L" shorthand (Ken: "I'm using h/m/l
as shortcut. I think the app should use high/medium/low"). `dry_time` states its direction
explicitly (high = slow/long to dry, low = fast) since high/low is inherently ambiguous for a
time concept without it.

**2026-07-08 — Nib `point_size` absorbs stub/italic mm widths; `line_width`/`line_variation`
dropped.** Real data showed stub-style widths (1.0/1.1/1.4/1.5mm) playing the identical role
`point_size`'s letter codes play for round nibs — same underlying fact (nib width), different
notation by convention. Added to the same `point_size` enum rather than a separate field.
`line_width` and `line_variation` were inherited from the original pre-review schema draft and
never re-derived against real data or vision.md — dropped as unjustified once `point_size`
covers what `line_width` was guessed to mean; nothing replaced `line_variation`.

**2026-07-08 — `inkings.nib_id` is required, not nullable; `rating` is 1-3 stars, not 1-5;
`flow`/`dry_time` are scaled values, not booleans.** A pen can't be written with unless a nib is
actually in it, so every real inking has one — no nullable case (this corrects an earlier,
still-wrong intermediate fix that only addressed the "stock nib" assumption without removing
nullability outright). `flow`/`dry_time` were originally lumped into the same
boolean-checkbox redesign as `feathering_observed`/`sheen_observed`, but they're scaled
qualities, not yes/no occurrences of something happening — fixed to
`enum(high/medium/low)`, consistent with every other scaled field in the schema.

**2026-07-08 — `purchases.vendor_id` is nullable; `updated_at` added.** Secondhand pens are
usually bought from an individual (a one-time private sale), not a recurring business worth a
permanent `vendors` row — forcing every private-party purchase through the controlled list was
genuine friction for a case that doesn't recur. `notes` covers "who" when `vendor_id` is unset.
`updated_at` was simply missing (`created_at` only), inconsistent with every other table.

**2026-07-08 — `users`/`sessions` and `import_runs` added — both real gaps, not additions.**
Auth was named as a Stack-level decision (`project-plan.md`: "lightweight session-cookie, single
seeded user") but never actually scheduled into any phase or given a schema at all — caught by
asking "what's missing overall," not by vision.md cross-referencing, since it was never in
vision.md to begin with. Scheduled to **Phase 2** step 1, before deploy plumbing — nothing
should ship reachable without the session gate already in place, even behind Tailscale's
private-network boundary. `import_runs` is a lightweight audit log (`operation_type`, `mode`,
`report_summary` json, `run_at`) for the now-four distinct import/refresh operations, each
written to at the end of every dry-run/commit — real record-keeping given how much judgment each
one involves, not just nice-to-have. Drizzle's own migration-tracking table is separate from
both of these and needs no design — it's infrastructure `drizzle-kit`/`migrate()` manage
automatically, not a table that belongs in the app's own Data Model.

**2026-07-08 — Database filename, path, and env var settled.** `project-plan.md`'s backup
command used `penventory.db` only as an illustrative example — never an actual decided config
value, and no env var name existed anywhere. Settled: filename `penventory.db`; dev path
`./data/penventory.db` (gitignored); container volume mount `/data/penventory.db`; env var
`DATABASE_URL` (Drizzle's own convention, even though SQLite isn't a network URL) holding
`file:./data/penventory.db`. Needed now because Phase 1 step 2 (Drizzle config/migrations) and
the Dockerfile volume mount both depend on a real value, not an example.

**2026-07-09 — SQLite driver: `better-sqlite3`, not `@libsql/client`.** `project-plan.md` said
"Drizzle ORM" but never named the underlying client — a real gap, since it decides how the
database file actually comes into existence. `better-sqlite3` is synchronous, has no
network/remote-sync layer (unlike `@libsql/client`, built for Turso's embedded-replica use case
this project doesn't have), and is the driver Drizzle's own SQLite docs lead with. Fits the
existing "single file, single user" and "no live external system state" rules cleanly.

**2026-07-09 — No shell database ships as a deploy artifact; startup migrations create the
schema from nothing.** Restates and confirms the existing "SQLite file is never part of the
deploy artifact" rule rather than changing it. SQLite creates the file itself, at the driver
level, the first time something opens a connection to a path that doesn't yet exist — not
something a migration or Drizzle has to do. On a genuinely fresh volume: the app opens
`DATABASE_URL`, `better-sqlite3` creates an empty file at that path, then the already-decided
apply-on-startup migration logic runs every committed migration file in order (starting from
step 2's controlled-list schema) against that connection, building the full schema from empty.
Nothing about this needs a distributed "shell" `.db` file, and nothing changes about how backup/
volumes work — this is what "apply pending migrations on startup" already implied, made explicit
because Ken asked directly whether an empty shell database needed distributing.

**2026-07-09 — Fuzzy-match algorithm: Damerau-Levenshtein via the `damerau-levenshtein` npm
package.** `resolveOrFlag` (Phase 1 step 3) and the import's duplicate detection (step 6) both
need a deterministic, pure similarity score between two short proper-noun strings — no live
external state, reused as one implementation in both places. Plain Levenshtein distance counts
an adjacent-letter swap as two edits; Damerau-Levenshtein counts it as one — directly matters
here because the concrete case already in the plan ("Piolt" flagged against "Pilot") is exactly
a transposition, not a substitution. Verified live against the npm registry (not recalled from
training data) before deciding: `damerau-levenshtein` v1.0.8, zero runtime dependencies, ~145M
downloads/month despite no publish since January 2022 — read as "small, correct, algorithm-
complete, embedded deep in the ecosystem" rather than "abandoned," given the download volume
relative to its size. Rejected alternatives: bigram/token-overlap scoring (doesn't model
single-character typos as directly), phonetic matching like Soundex/Metaphone (solves
sounds-alike, not spelled-alike — wrong problem), embedding/model-based similarity (breaks the
no-live-external-state rule, non-deterministic, overkill for short strings).

**2026-07-09 — CSV library: `csv-parse` for reading, `csv-stringify` for writing.** Two real
gaps, not one — `project-plan.md` never named a CSV library at all, and CSV isn't read-only:
Phase 1 steps 6/8 and Phase 4 read FPC exports, but Phase 6 step 4 ("Export (CSV/full)") writes
Penventory's own data back out, gated by a contract test for field-completeness. Verified live
against the npm registry before deciding (not recalled from training data): `csv-parse` (7.0.1,
0 runtime deps, ~59.7M downloads/month, sync API confirmed alongside its stream API, delimiter
fully configurable — needed for FPC's semicolon-delimited files) and `csv-stringify` (6.8.1, 0
runtime deps, ~29.8M downloads/month) — same project/maintainer as `csv-parse`, so read and
write share one config vocabulary for delimiter/quoting rather than two unrelated
implementations for what's conceptually symmetric work. Rejected: `fast-csv` (bundles its own
`@fast-csv/format` + `@fast-csv/parse` as real runtime dependencies, not actually zero-dep
despite being one package name) and `papaparse` (its `unparse()` write path is genuinely
first-class, not an afterthought, but the library is fundamentally browser-first — web workers,
client-side large-file streaming — a design mismatch for a Node-only CLI/route use case).

**2026-07-08 — No improvement backlog in this file.** Was previously structured as "decision log
for decisions made; improvement backlog for things noticed but not acted on" — a known
anti-pattern from get-clear, where the backlog section degrades into a todo list embedded in
what's supposed to be a pure decision record. Removed. Something noticed but not yet decided
gets a GitHub issue or a line in `docs/punch-list.md`, not a section here.
