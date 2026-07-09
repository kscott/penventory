# Penventory — Project Plan

A self-hosted fountain pen collection manager. Built from scratch for a single owner, replacing
Fountain Pen Companion. This document is the technical translation of everything settled in
`vision.md` and `PRD.md` — those are the source of truth for *what*
and *why*; this one covers *how*.

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js (`node:22-slim`) | Widest, most battle-tested native-addon compatibility — matters because `sharp` (image processing) uses compiled bindings. Bun/Deno considered and rejected for this reason; not worth the risk on a hands-off app. |
| Framework | SvelteKit | Compiles away (no virtual DOM), and has a built-in `animate:flip` directive — purpose-built for "a list re-sorts and every item smoothly animates to its new position." That's the single feature the visual-browsing phase depends on most; no third-party animation library needed. |
| Database | SQLite | Single user, single file, backup = one command (see Containerization). |
| DB layer | Drizzle ORM | Type-safe, schema defined directly in TypeScript (no separate DSL, no codegen step), stays close to real SQL. Lighter footprint than Prisma — no separate query-engine process. Ships with Drizzle Studio (GUI data browser) for peeking at data without writing code. |
| Color science | `colorjs.io` | Built by the authors of the CSS Color Level 4 spec — as rigorous as color math gets. Handles CIE Lab conversion and ΔE distance, the exact math `gen_inks.py` already proved out. |
| Image processing | `sharp` | Fast, production-grade, used at real scale. Handles swatch-photo extraction, composite generation, resizing. |
| Validation | Zod | Runtime validation at every API boundary; schemas shared between client and server. This is also the documented contract Claude queries against. |
| Unit/integration testing | Vitest | SvelteKit's own documented testing tool. Fast, ESM-native. |
| E2E/contract testing | Playwright | Drives a real browser for UI behavior (the shuffle animation, filters); also used to hit real HTTP endpoints for API contract tests. |
| Logging | `pino` | Structured JSON logs at service boundaries — not `console.log`. |
| Metrics | `prom-client` | Exposes `/metrics` for the existing Prometheus instance on Quarto to scrape. |
| Auth | Lightweight session-cookie, single seeded user | Tailscale is the real security boundary (private network, no public exposure); this is defense-in-depth behind it, not the primary control. |
| Hosting | Docker on Secondo, `personal-apps` stack | See Infrastructure section below — reasoning for host placement and stack grouping. |
| AI | Claude API / skill | Deferred to the ledger/suggestion phase (Phase 4+) — no cost or dependency during the visuals-first build. |

---

## Architecture — layered, so it's actually testable

```
routes/                    SvelteKit routes — HTTP-only concerns (parse request, call a
                            service, format response). No business logic here.
lib/server/services/       Business logic — ledger rules, near-dupe clustering, purchase-
                            history aggregation, tag AND/OR filtering. Framework-agnostic,
                            depends on repository *interfaces* not Drizzle directly. This is
                            what gets unit tested.
lib/server/db/             Drizzle schema + repository functions. The only layer that
                            imports Drizzle.
lib/shared/                Zod schemas, shared between client and server, and the documented
                            contract Claude's queries validate against.
```

Routes stay thin specifically so services can be unit-tested without spinning up the whole
app, and so repositories can be swapped for fakes in tests without touching real SQLite.

---

## Testing discipline — built in from commit 1, not bolted on

1. **Testing infrastructure lands before any feature code.** Repo init, TypeScript strict mode,
   ESLint + typescript-eslint, Prettier, Vitest config with one trivial passing test, Playwright
   config with one trivial smoke test, a GitHub Actions workflow running all of it — green
   before a single Pen/Ink/Nib model exists.
2. **Build in vertical slices, not horizontal layers.** One thin end-to-end feature at a time
   (schema → repository → service → route → UI), fully tested at every layer, before starting
   the next slice. Never "build everything, then add tests."
3. **Definition of done, per slice:** a unit test for new service logic; an integration test if
   it touches the database; a contract test for any new/changed API endpoint; a Playwright test
   for anything user-visible. Missing any of these means the slice isn't done.
4. **CI blocks bad code from landing.** Lint, typecheck, unit, integration, e2e smoke, and a
   Docker build run on every push. Nothing merges with a red pipeline.
5. **Coverage is a visible number, not a claim.** Vitest's built-in coverage reporting, with a
   minimum threshold enforced in CI — gives confidence without requiring anyone to read the test
   files themselves.
6. Nontrivial changes get run through the `/verify` step (actually exercising the change
   end-to-end) before being called done, not just "tests pass."

---

## Data model

Purchase history is now a shared table across pens, inks, and nibs (a real change from the
original plan, driven by §5.4 of the vision doc: ink and nib both need *multiple* purchase
events over their life, not one).

### Controlled lists (all share one mechanism)
Every field below with real-world naming-drift risk (fat-fingered typos, spelling variants,
proprietary names for the same underlying thing) uses the same mechanism: a canonical table,
`resolveOrFlag(type, name, scopeId?)` for lookup/creation, and the polymorphic `aliases` table
for known alternate names with zero string similarity to the canonical value (e.g. "Namiki" for
"Pilot," "Journaler" for the "Cursive Italic" nib shape). Full reasoning and the four-outcome
resolution order (exact match / alias match / fuzzy-flagged / genuinely new) in
`phase1-plan.md` step 3.
```
brands:          id, name (unique)
lines:           id, brand_id → brands, name
models:          id, brand_id → brands, name           (pen equivalent of lines)
pen_materials:   id, name (unique)                       (pen body material: Acrylic, Ebonite...)
nib_materials:   id, name (unique)                       (Gold, Steel, Titanium...)
finishes:        id, name (unique)                       (plating/trim color — Gold-tone,
                                                            Rhodium/Silver, Rose Gold, Black PVD.
                                                            Shared by pens.trim_color_id AND
                                                            nibs.finish_id — same real-world
                                                            vocabulary, not two lists. Reuse
                                                            pattern, same as maker_id → brands.)
filling_systems: id, name (unique)                       (real drift confirmed in Ken's own FPC
                                                            export — "Cartridge/Converter" had
                                                            three spellings)
nib_shapes:      id, name (unique)                       (Round/Stub/Italic/Oblique/Cursive
                                                            Italic/Architect/Needlepoint/Music/
                                                            Naginata Togi... merges what used to
                                                            be separate tipping_type + grind_type
                                                            fields — same underlying fact, "what
                                                            shape is this tip," regardless of
                                                            whether it shipped that way or was
                                                            ground later)
vendors:         id, name (unique)                       (merges what used to be separate
                                                            purchases.vendor + nibs.nibmeister
                                                            strings — a nibmeister IS a vendor,
                                                            someone paid for a service; keeping
                                                            them separate meant the same real
                                                            person/business, e.g. Kirk Speer /
                                                            PenRealm, could show up as two
                                                            disconnected strings)
aliases:         id, alias, aliasable_type enum(brand/line/model/pen_material/nib_material/
                     finish/filling_system/nib_shape/vendor), aliasable_id,
                     unique(alias, aliasable_type)
```
`pen_materials` and `nib_materials` are deliberately separate tables, not one shared
"materials" list — different vocabularies (Acrylic/Ebonite vs. Gold/Steel/Titanium), same
mechanism. `maker` (see `inks` below) is **not** in this list — it reuses `brands` directly via
a foreign key, since a maker is the same *kind* of entity as a brand, just in a secondary role.

### pens
```
id
brand_id              → brands
model_id               → models
color                  string   (FPC's resin/material NAME, e.g. "Primary Manipulation 5.5" —
                                  NOT a real color value or a category; genuinely free text,
                                  high-cardinality, not a controlled-list candidate)
material_id             → pen_materials
trim_color_id            → finishes
filling_system_id        → filling_systems
size_category            enum(pocket / standard / slim / oversized)
condition                enum(new / vintage / second-hand)
accessories_note         text     ("came with: sleeve, pin; original box")
notes                    text
ownership_state           enum(active / retired / rehomed)
ownership_changed_on      date
created_at / updated_at
```

### nibs
Standalone objects — owned independently, moveable between pens. `brand_id` is **nullable** —
confirmed real case: a bare point size in FPC's Nib field (just "F"/"M"/"B", no other
qualifiers) means Steel, base_size #6, and no recorded manufacturer (JoWo vs. Bock vs. other —
genuinely not knowable from the data). Brand stays unset until Ken resolves it by hand.
```
id
brand_id              → brands (nullable — see above)
material_id             → nib_materials
purity_id                → nib_purities   (karat — a real lookup table, not a TypeScript
                                    enum. Exact-match only, deliberately NOT in
                                    ALIASABLE_TYPES / never fuzzy-matched (see point_size
                                    below for why) — but still a real table, seeded with
                                    the known set (9K/14K/18K/21K/22K), so a genuinely new
                                    karat is a data operation, not a code change + deploy.
                                    Nullable — Steel nibs have no karat at all.)
base_size_id              → nib_base_sizes   (nib housing size — #5/#6/#8 seeded, same
                                    reasoning and exact-match-only mechanism as purity_id)
point_size_id             → nib_point_sizes   (EF/F/FM/MF/F/M/M/OM/CM/B/BB/BBB/XXXF/
                            1.0/1.1/1.4/1.5 seeded — same mechanism as purity_id/
                            base_size_id. Confirmed against Ken's real FPC data: "FM",
                            "MF", and "F/M" are THREE valid, distinct values — Pilot's
                            Fine-Medium, Sailor's Medium-Fine, and Diplomat's slash
                            convention (e.g. the Diplomat Viper) — not typos of each
                            other. This is exactly why point_size is exact-match-only and
                            never in ALIASABLE_TYPES: a fuzzy matcher would have actively
                            mis-flagged FM/MF as near-duplicates of each other. The mm
                            values (1.0/1.1/1.4/1.5) are the same concept as the
                            letter-code values — nib width — just the stub/italic
                            convention instead of the round-nib convention; confirmed
                            against real rows like "1.1 Stub" and "1.1 14K Stub".
                            Absorbs what a separate `line_width` field used to cover
                            (dropped — redundant once mm widths live here).
shape_id                 → nib_shapes   (what the tip currently IS — see Controlled lists above)
finish_id                 → finishes   (plating color — Black PVD, Rose Gold, etc. Same table
                                          pens.trim_color_id points at; same real-world
                                          vocabulary, not a nib-specific list)
custom_name               string   (the specific nibmeister's branded name for this grind, e.g.
                                      "Journaler" — distinct from shape; feeds the aliases table
                                      as the alias text once it's linked to a canonical shape)
is_custom_grind           boolean  (was there a trackable grind event, regardless of who
                                      performed it — factory custom-order, third-party
                                      nibmeister, or already ground when acquired)
grind_description         text     (freeform elaboration, distinct from custom_name's proper-
                                      noun label)
nibmeister_id             → vendors  (who performed the grind, if known — see Controlled lists)
ground_on                 date
feedback                   enum(high / medium / low)   (texture feedback)
wetness                    enum(high / medium / low)
notes                      text
created_at / updated_at
```

### pen_nibs
```
id
pen_id               → pens
nib_id               → nibs
installed_on         date
removed_on           date     (null = currently installed)
notes                text
```

### inks
```
id
brand_id             → brands
line_id              → lines
maker_id             → brands (nullable)   (reuses brands directly, not a separate table — a
                                              maker is the same kind of entity as a brand, just
                                              in a secondary role; a brand row may exist only as
                                              a maker reference and never as a direct brand_id,
                                              and that's expected)
name                 string    (the ink's specific product name — free text, high-cardinality,
                                  not a controlled-list candidate)
type                 enum(bottle / sample / cartridge)   (kept even though "cartridge"
                                  doesn't appear in Ken's current export; it's a real FPC-defined
                                  value and a plausible future purchase)
color_fpc            string    (hex — FPC's listed value. NOT a permanent one-time snapshot:
                                  FPC's own color value is itself crowdsourced from all users'
                                  distinct entries and can legitimately change over time. Updated
                                  only via an explicit, separate refresh operation — see
                                  `phase1-plan.md` — never silently overwritten by the main
                                  import, and never touches color_swatch/color_colorimeter/
                                  color_override_source or anything else on the row.)
color_swatch          string    (hex, nullable — swatch-photo-extracted value, populated by
                                  Phase 3's photo pipeline)
color_colorimeter      string   (hex, nullable — colorimeter-measured value, populated from a
                                  separate data source, `colorimeter.csv`. Imported in **Phase
                                  4**, not Phase 3 — reuses the more refined match/diff/review
                                  import pattern established by then (currently_inked.csv's
                                  fuzzy matching, color_fpc's diff-reviewed refresh), rather than
                                  bolting a one-off importer onto Phase 3's photo work.)
color_community        string   (hex, nullable — from an external source like InkSwatch or
                                  Mountain of Ink; vision doc explicitly welcomes these as
                                  additional cross-references)
color_override_source   enum(fpc / swatch / colorimeter / community)  (nullable — Ken's
                                  explicit manual pick of which of the four values above is
                                  authoritative for this specific ink, when the default
                                  precedence isn't what he wants. This is what the vision doc's
                                  "corrected hex" idea actually is — not a fifth stored hex
                                  value, a pointer at one of the four real ones.)
color                — COMPUTED, not stored. "Effective" color resolved by a lookup service at
                        read time: color_override_source's target if set, otherwise default
                        precedence **swatch → colorimeter → fpc** among whatever's actually
                        populated, falling back to color_fpc (the only field guaranteed to exist
                        for every ink). This is what Phase 2's browse views and near-dupe
                        clustering actually use as "the ink's color."
color_family          — COMPUTED, not stored. Derived from the effective `color` via Phase 2's
                        color-family bucketing service, same mechanism as the Color Family
                        browse view. Documented here explicitly so it doesn't get rebuilt as a
                        tag by mistake — vision.md is explicit that color family is "a real
                        structured attribute... not a tag."
sheen                enum(high / medium / low)
shimmer              boolean
shading              enum(high / medium / low)
permanence            boolean
wetness               enum(high / medium / low)
flow                  enum(high / medium / low)   (distinct from wetness — both real, independent
                                           properties)
used                  boolean  — COMPUTED: true if ≥1 inking ledger entry exists (Phase 4)
swatched              boolean  — COMPUTED: true if a swatch photo/composite exists (Phase 3)
notes                 text
ownership_state        enum(active / retired / rehomed)
ownership_changed_on   date    (parity with pens — was missing, no reason for the asymmetry)
created_at / updated_at
```

### purchases
Shared across pens, inks, and nibs. **This is the multi-entry history** — ink rebuys and nib
grinds/modifications each get their own row here, not a flat field on the parent. `vendor_id`
is **nullable** — a real, common case: secondhand pens are usually bought from an individual
(a forum classified, a one-time private sale), not a recurring business worth adding to the
`vendors` controlled list. Leave `vendor_id` unset and use `notes` for "who," rather than
forcing every one-off private seller through the same mechanism as PenRealm/Kirk Speer, which
are genuinely recurring, worth-tracking entities.
```
id
purchasable_type     enum(pen / ink / nib)
purchasable_id        integer
vendor_id             → vendors (nullable — see above)
date_ordered           date
date_delivered          date
price                   decimal
currency                string   (default USD)
notes                   text     (e.g. "came bundled with [pen]" — see §5.7; or who a
                                    private-party seller was, when vendor_id is unset)
created_at / updated_at
```

### inkings
The ledger core — pen + ink + nib matched together, with a Start/Mid/End lifecycle. Performance
and end-reason are both modeled as discrete boolean columns, not an enum or free text — vision
doc explicitly calls these "checkboxes" (plural, multi-select: a cleaning could involve *both*
"ran dry" and "ink issue"), and a single text/string field makes structured reporting
unreliable at best (string-matching against prose) or impossible (a forced single choice
silently discards whichever reason didn't "win").
```
id
pen_id                  → pens
ink_id                  → inks
nib_id                  → nibs      (**required, not nullable** — a pen can't be written with
                                       unless a nib is actually installed, so every real inking
                                       has one. NOT an implicit "stock nib" either — which nib is
                                       "stock" isn't well-defined once a swap has happened; this
                                       is whichever specific nib was actually in the pen,
                                       consistent with pen_nibs's install/remove history.)
started_on               date
ended_on                  date       (null = still loaded)
ended_ran_dry             boolean
ended_disliked            boolean
ended_needed_pen          boolean
ended_ink_issue           boolean
end_note                  text       (freeform, alongside the checkboxes)
rating                    integer    (1-3 stars, null = unrated)
flow                      enum(high / medium / low)   (a scaled quality, not an occurrence — unlike
                                               feathering/sheen below, which either happened or
                                               didn't)
dry_time                  enum(high / medium / low)   (high = long time to dry (slow); low = fast
                                               to dry. Direction stated explicitly here since
                                               "high/low" is ambiguous for a time concept
                                               without it.)
feathering_observed       boolean
sheen_observed            boolean
performance_note          text       (freeform, alongside the checkboxes)
created_at / updated_at
```
### observations
Standalone dated ledger entries, OR a "Mid-use" note attached to a specific active inking
(vision doc's third lifecycle moment, alongside Start/End) — one table covers both, since both
are just "a dated note about something." `subject_type`/`subject_id` and `inking_id` are
mutually exclusive, never both set on the same row: a standalone observation is about a pen/nib
directly; an inking-attached one is implicitly about whatever pen/ink/nib that inking already
references, so there's nothing to duplicate. Multiple observations can attach to the same
inking over its life (day 3, day 20, ...) — "a collection of reports attached to an inking."
```
id
subject_type          enum(pen / nib)  (nullable — set only for standalone observations)
subject_id             integer  (nullable — set only for standalone observations)
inking_id              → inkings (nullable — set only for inking-attached observations)
observed_on             date
note                    text
```

### tags / taggables
Polymorphic, user-curated only — never auto-generated.
```
tags:       id, name
taggables:  tag_id, taggable_type enum(pen/ink/nib), taggable_id
```

### wishlist_items
```
id
name                  string
brand_id              → brands (nullable)
line_id               → lines (nullable)
notes                 text      (why it caught his eye)
converted_ink_id       → inks (nullable — set once purchased)
converted_at           datetime  (nullable)
created_at
```
Never deleted on conversion — same "preserved, hidden by default" pattern as ownership state.

### photos
```
id
owner_type            enum(pen / ink)
owner_id               integer
kind                   enum(swatch / colorimeter_composite / pen_photo)
file_path              string
created_at
```
Ink photos carry the existing three-source composite pipeline (swatch + colorimeter + FPC
value). Pen photos are evaluated point-in-time for aesthetic-pairing suggestions — nothing
extracted or stored beyond the photo itself (see vision doc §Photos).

### ai_suggestion_logs
Append-only provenance log for Phase 5's pairing-suggestion features — never joined into or
blended with `inkings`, notes, or ratings. This is what makes the vision doc's "AI-derived
content stays strictly separate from what Ken enters himself" rule concrete rather than a
policy with nowhere to live.
```
id
intent                 enum(old_favorite / something_new / find_match / aesthetic_match)
input_context          json     (what was asked)
cited_record_ids       json     (which inkings/pens/inks/tags the response drew on)
sample_size            integer
response_summary       text
created_at
```

### users / sessions
Named as a Stack-level decision ("lightweight session-cookie, single seeded user") but never
actually scheduled into a phase or given a schema — a real, total gap, not a small oversight.
Minimal, since there's exactly one user, ever, manually seeded — no registration flow, no
password reset, no multi-user anything.
```
users:    id, username, password_hash, created_at
sessions: id, user_id → users, session_token (unique), expires_at, created_at
```

### import_runs
Audit log for the now-four distinct import/refresh operations (catalog import, FPC color
refresh, `colorimeter.csv` import, `currently_inked.csv` historical import) — each involves
real judgment (Ken's reviewed decisions), so a record of when each last ran and what it did is
worth having, not just nice-to-have.
```
id
operation_type      enum(catalog_import / color_refresh / colorimeter_import /
                       historical_inkings_import)
mode                 enum(dry_run / commit)
report_summary       json     (counts — new / skipped / aliased / merged, per the reviewed report)
run_at               datetime
created_at
```

**Note on `used` / `swatched`:** listed above as ink columns, but neither can exist from
Phase 1 — both are computed from tables that don't exist yet. `used` is added by migration in
**Phase 4**, once `inkings` exists (true if ≥1 ledger entry exists). `swatched` is added by
migration in **Phase 3**, once `photos` exists (true if a swatch photo/composite exists). See
`docs/phase1-plan.md`'s "Deferred columns" section for the full reasoning. `purchases` follows
the same logic and still waits for Phase 4. `pen_nibs` does **not** — pulled forward into
**Phase 1 step 5**, since the FPC import needs it to link an imported pen to its parsed stock
nib; Phase 4 step 1 builds the assign/remove UI and "current nib" query on top of that
already-existing schema, not the schema itself. See `ARCHITECTURE.md`'s 2026-07-09 entry.

---

## Feature phases

Sequencing follows the "visuals first" decision — see vision doc's Build Sequencing section.
Each phase below is summarized at a paragraph level; full ordered steps with a gate per step
live in `docs/phaseN-plan.md` (`phase1-plan.md` through `phase6-plan.md`), same treatment
`phase0-plan.md` already got.

### Phase 0 — Setup
- Repo scaffold, TypeScript strict mode, ESLint/Prettier
- Vitest + Playwright configs, each with one trivial passing test
- GitHub Actions CI (lint, typecheck, unit, integration, e2e smoke, Docker build)
- Dockerfile (multi-stage, `node:22-slim` runtime, non-root user)
- Base SvelteKit shell: responsive layout, navigation

All of the above green before any real feature exists.

### Phase 1 — Data layer
- Drizzle schema for brands/lines/pens/inks/nibs/tags (core tables only — purchases/inkings
  come with their respective features)
- Migrations, integration-tested against a real in-memory SQLite instance
- FPC import script: `collected_inks.csv` / `collected_pens.csv` / `currently_inked.csv` →
  tables, including the **brand/line normalization pass** (collapsing spelling drift into the
  canonical lists — required before canonical-list entry is enforced going forward)
- Import tested against real sample CSVs; verify counts, spot-check

### Phase 2 — Visual browse experience (the actual point of building an app)
Each view is its own fully-tested vertical slice — schema/repository/service/route/UI, unit +
integration + contract + Playwright tests, before moving to the next:
- Color Family view
- Color Wheel view
- Tone view
- Brand A–Z view
- The reshuffle/reflow animation (`animate:flip`) tying the views together
- Near-Dupes view (second wave, per vision doc — after the four above)

No ledger, no ratings, no AI yet — this phase only needs pen/ink/color data, most of which
already exists from the FPC import.

### Phase 3 — Core CRUD and tagging
- Ink/pen/nib list, show, add, edit
- Tag-based filtering with AND/OR combination
- Bulk operations for inks (multi-select, bulk field update, preserving scroll position —
  FPC's biggest pain point)

### Phase 4 — Ledger and purchase history
- Inking workflow: Start/Mid-use/End lifecycle, ratings, checkboxes+notes
- Nib assignment history (install/remove dates)
- Purchase history (shared table across pens/inks/nibs) — including ink rebuys and the
  bundled-ink $0-entry pattern
- Wishlist (save/convert, preserved-hidden pattern)
- Reporting views: longest-untouched list, currently-inked board

### Phase 5 — AI-assisted suggestions
- API layer Claude actually queries — the Zod-validated contract from day one, now put to use
- Pairing suggestion flows (old favorite / something new / aesthetic match), grounding rules
  from the vision doc (cite sources, label inference, show sample size)
- Aesthetic pairing: point-in-time pen-photo evaluation, no precomputed/stored color

### Phase 6 — Polish
- Nib storage/location tracking (open question — design when this phase starts)
- Corrected/canonical hex feature (open question — see vision doc)
- Export (CSV/full) — "someday," not blocking

---

## Containerization

**Dockerfile** — multi-stage: builder stage (Node, install deps, `adapter-node` build),
runtime stage on `node:22-slim` (Debian, not Alpine — `sharp`'s native bindings are the most
reliably supported there), non-root user, `/healthz` endpoint for Docker/Uptime Kuma healthchecks.

**Volumes** — one for the SQLite file, one for photos.

**Backup — a real correctness detail, not just "copy the file."** SQLite in WAL mode isn't
safely backed up by a raw `cp` while the app is running — the `-wal`/`-shm` sidecar files can be
mid-write. Use `sqlite3 penventory.db ".backup backup.db"` (or `VACUUM INTO`) for a guaranteed-
consistent snapshot, then let that file land in the same NAS backup routine already covering the
rest of the homelab.

**Observability** — `/metrics` (via `prom-client`) added as a new scrape job in Quarto's existing
`prometheus.yml`. A **separate, non-kiosk Grafana dashboard** for Penventory's own metrics — not
crammed onto the kiosk dashboard's ~48-row budget, pulled up ad hoc in the Grafana UI instead.
`/healthz` gets an Uptime Kuma monitor, same pattern as every other homelab service.

---

## Infrastructure — GitOps via Portainer

Portainer CE is already installed on Secondo (port 9000, running since the original Ubuntu
migration) but has never actually been configured — its data directory hasn't changed since
install day. Rather than standing up a new GitOps tool, the plan is to actually turn Portainer
on: git-based stacks, pointed at paths in the `homelab` repo, polled/redeployed automatically on
change.

**No wholesale refactor of the existing homelab repo required.** Portainer stacks map to
whatever compose file they're pointed at — existing per-host files can be imported as-is. Docker
Compose itself already diffs service definitions and only recreates what changed, regardless of
how many services share a file.

**Stack split, decided as a quality improvement while touching this anyway:**

| Stack | Host | Contents |
|---|---|---|
| `quarto/observability` | Quarto | Grafana, Prometheus, node-exporter, cadvisor, Uptime Kuma, opnsense-exporter — unchanged, already coherent as a single-purpose host |
| `secondo/media` | Secondo | Plex, Sonarr, Radarr, Prowlarr, qBittorrent, beets |
| `secondo/host-tooling` | Secondo | Portainer, Dozzle, Watchtower, Duplicati, node-exporter, cadvisor |
| `secondo/personal-apps` | Secondo | **Penventory** (new), Mealie (planned, not yet built — see `~/Notes/home-projects-kanban.md`) |

Splitting media from host-tooling on Secondo specifically: media-stack tinkering (adding
indexers, adjusting qBittorrent settings) shouldn't be able to break Portainer/cadvisor/Watchtower
via a bad compose edit in the same file. node-exporter/cadvisor don't need to share a Docker
network with anything to keep working — Prometheus reaches them over the LAN via published host
ports, so splitting is safe with no connectivity risk.

**Host placement reasoning (Penventory → Secondo, not Quarto):** both hosts have ample headroom
(Quarto: 25GB/32GB RAM available, load 0.5-0.9; Secondo: 13GB/16GB available, load ~0.1) — this
isn't a capacity decision. Quarto already carries observability + the Home Assistant VM + the
always-on kiosk browser; Secondo currently carries media + host-tooling. A personal-use app
(recipe manager, pen collection tracker) is a third, distinct role that fits better alongside
Secondo's existing "things you actually use" character than adding a fourth responsibility to
Quarto's already-loaded plate. Mealie was independently earmarked for Secondo back in March,
reinforcing the same grouping.

**Build/deploy**: CI builds and pushes the image to GitHub Container Registry on every merge to
main — not built on-host. Secondo (like Quarto) is 2012-era hardware; a multi-stage Node build
would be slow and wasteful there. Portainer pulls the pre-built, already-tested image.

**Remote access** — unchanged from the original plan: Tailscale, private mesh VPN, no public
exposure, no port forwarding.

---

## Open questions

Carried over from the vision doc, still genuinely unresolved:
- Corrected/canonical hex per ink — real feature or not worth formalizing (see vision doc Photos
  section)
- Nib storage/location tracking — not designed at all yet
- Bulk operations for pens/nibs, not just ink — unconfirmed need

---

## Repo

`~/dev/penventory/` — create at the start of Phase 0.
