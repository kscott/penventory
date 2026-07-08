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

### brands / lines
Canonical lookup tables — the whole reason FPC's free-text Brand/Line drifted into duplicate
spellings. `lines` scoped to a brand (a Line belongs to its Brand).
```
brands:  id, name
lines:   id, brand_id, name
```

### pens
```
id
brand_id            → brands
model                string
color                string   (FPC's resin/material name — NOT a real color value, see vision doc)
material             string
trim_color            string
filling_system        string
size_category         string   (pocket / standard / oversized)
condition             string   (new / vintage / second-hand)
accessories_note      text     ("came with: sleeve, pin; original box")
notes                 text
ownership_state        string  (active / retired / rehomed)
ownership_changed_on   date
created_at / updated_at
```

### nibs
Standalone objects — owned independently, moveable between pens.
```
id
brand                string
base_size            string
tipping_type         string
flexibility          string
is_custom_grind      boolean
grind_type           string
grind_description    text
nibmeister           string
ground_on            date
line_width           string
line_variation       string
feedback             string
wetness              string
notes                text
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
name                 string
type                 string   (bottle / sample / cartridge)
color                string   (hex — swatch/colorimeter-derived, see Photos)
maker                string
sheen / shimmer / shading / permanence   (fixed properties, not per-inking)
wetness               string
flow                  string
used                  boolean  — COMPUTED: true if ≥1 inking ledger entry exists
swatched              boolean  — COMPUTED: true if a swatch photo/composite exists
notes                text
ownership_state       string   (active / retired / rehomed)
created_at / updated_at
```

### purchases
Shared across pens, inks, and nibs. **This is the multi-entry history** — ink rebuys and nib
grinds/modifications each get their own row here, not a flat field on the parent.
```
id
purchasable_type     string   (pen / ink / nib)
purchasable_id        integer
date_ordered          date
date_delivered         date
vendor                string
price                 decimal
currency              string   (default USD)
notes                 text     (e.g. "came bundled with [pen]" — see §5.7)
created_at
```

### inkings
The ledger core — pen + ink + nib matched together, with a Start/Mid/End lifecycle.
```
id
pen_id                → pens
ink_id                → inks
nib_id                → nibs      (null = stock nib)
started_on            date
ended_on               date       (null = still loaded)
end_reason            string     (ran dry / disliked it / needed the pen / ink issue)
rating                integer    (1-5, null = unrated)
performance_notes     text       (checkboxes + freeform: flow, dry time, feathering/bleed, shading/sheen)
created_at / updated_at
```

### observations
Standalone dated ledger entries not tied to an active inking (§5.1 — "became my desk pen," a
condition note, anything worth recording independent of a pairing).
```
id
subject_type          string    (pen / nib)
subject_id             integer
observed_on            date
note                   text
```

### tags / taggables
Polymorphic, user-curated only — never auto-generated.
```
tags:       id, name
taggables:  tag_id, taggable_type (pen/ink/nib), taggable_id
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
owner_type            string   (pen / ink)
owner_id               integer
kind                   string   (swatch / colorimeter_composite / pen_photo)
file_path              string
created_at
```
Ink photos carry the existing three-source composite pipeline (swatch + colorimeter + FPC
value). Pen photos are evaluated point-in-time for aesthetic-pairing suggestions — nothing
extracted or stored beyond the photo itself (see vision doc §Photos).

---

## Feature phases

Sequencing follows the "visuals first" decision — see vision doc's Build Sequencing section.

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
