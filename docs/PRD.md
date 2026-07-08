# Penventory — Product Requirements Document

Generated from `vision.md`. That document is the source of truth and the
record of how these decisions were reached; this one describes the product itself.

---

## 1. Summary

Penventory is a self-hosted, single-user application for managing a fountain pen collection —
pens, inks, and nibs — built to replace Fountain Pen Companion (FPC). Where FPC is a static
catalog with shallow attributes and almost no reporting, Penventory is built around **living
ledgers**: an ongoing record of what's been used, with what, how it performed, and why a given
pairing ended. The goal is not a bigger spreadsheet. It's a tool that gets used more than it gets
maintained, and that measurably increases how much of the existing collection actually gets used
— not how much gets added to it.

---

## 2. Problem statement

FPC captures basic inventory and a pen+ink fill event, but:

- Pen attributes are shallow — no real modeling of nib, purchase detail, or condition.
- Reporting is nearly absent — no way to look back across the collection for patterns.
- Nib is a free-text string on the pen, not a trackable thing with its own history.
- Tags exist but can't be filtered meaningfully, and FPC pollutes the tag list with
  auto-generated entries.
- Ink data is stronger, but has no purchase tracking and an artificial public/private notes
  split that serves no purpose for a single user.
- Free-text Brand/Line entry lets spelling drift fragment what should be one brand ("Pilot" /
  "PILOT" / "Pilot Namiki"), quietly corrupting any brand-level report.

Beyond FPC's specific gaps, a second, larger problem: prior attempts to improve on this
(color-similarity tooling built in Python, producing static HTML output) were technically sound
but never got used. The output was disconnected from any live system — no link back to a record,
no action to take. It read as a demo, not a tool. Penventory's design has to specifically avoid
repeating that failure.

---

## 3. Goals

- Track pens, inks, and nibs with real depth — each a first-class entity with its own attributes
  and purchase history.
- Build an ongoing usage ledger per pen/ink/nib, not a static current-state snapshot.
- Make curation (what's unused, what to rehome) an active, supported workflow — not an
  afterthought bolted onto search.
- Increase how much of the existing collection gets used. This is the primary success metric,
  not inventory size or data completeness.
- Reinforce purchasing discipline already in progress — a wishlist and pre-purchase duplicate
  checks act as deliberate friction against impulse buys.
- Make Penventory's data natively accessible to Claude, so suggestions and lookups can happen in
  a conversation rather than requiring a trip to the app's own UI.
- Keep the collection's brand/line taxonomy clean by construction — canonical lists, not free
  text, so reports built on it (brand diversity, singleton brands, etc.) stay trustworthy.

## Non-goals

- **No multi-user or social features.** No sharing, no ink-swap matching, no leaderboards, no
  public-facing views. Single collection, single owner, full stop.
- **No proactive notifications or nagging.** The app does not pop up unprompted suggestions.
  Information is pulled when wanted, not pushed.
- **No precise physical measurements** (size/weight) for pens — a rough category (pocket /
  standard / oversized) is sufficient.
- **No current-value or insurance/replacement-value tracking.** Purchase price, vendor, and date
  are the full extent of financial record-keeping. No ongoing valuation research.
- **No shipping-cost line item** separate from purchase price.
- **No paper/notebook tracking as a structured entity**, for now — freeform notes cover it if it
  matters for a given pairing. (Architecture should not preclude adding this as a fourth
  first-class entity later, alongside pen/ink/nib.)
- **No dedup-detection logic for bundled ink** — the user already manually distinguishes new
  colors from duplicates; the app doesn't need to automate that judgment. (What changed: the
  bottle itself is now countable — see §5.4/§5.7 — the judgment call stays manual either way.)
- **No pen-level "role" tracking** (dedicated/workhorse vs. rotation) — considered as a way to
  disambiguate refill-frequency signal, but judged an edge case not worth building. The
  enjoyment-rating signal (§5.1) resolves the underlying ambiguity on its own.
- **No automated swatch-label reading (OCR/vision).** The existing manual workflow — Claude Code
  visually reading handwritten labels off lightbox photos — works, and the API cost of automating
  it isn't worth taking on even though it would be small. Stays a manual step.
- **No precomputed/stored pen color extraction.** Aesthetic-pairing suggestions evaluate a pen's
  photo fresh at the moment of the ask (see §6.5) rather than storing an extracted color or
  palette per pen.

---

## 4. Users

Single user. No roles, no permissions model beyond "the owner."

---

## 5. Core concepts

### 5.1 Three living ledgers

Pen, ink, and nib are each first-class entities with their own ongoing history, not rows in a
static catalog:

- **Pen ledger** — every inking it's held, performance notes, standalone observations over time.
- **Ink ledger** — every pen it's gone into.
- **Nib ledger** — where it's been used, how it feels, independent of any single pen.

A ledger entry can be logged at any time — a standalone observation ("this pen feels looser than
it used to") doesn't require an active inking to attach to. This same pattern — a dated,
standalone entry with no active pairing required — is what makes a dedicated "pen role" field
unnecessary (see §11): "became my desk pen" is just an instance of this, not a new mechanism.

### 5.2 The inking event

An inking (pen + ink + nib matched together) has a lifecycle, not a single timestamp:

1. **Start** — the pairing is recorded.
2. **Mid-use** *(optional)* — a note logged partway through, if something's worth capturing.
3. **End** — the real reflection point, typically at cleaning-out time. The *reason* it ended is
   captured explicitly and distinctly from the date: ran dry naturally (a positive signal) vs.
   cleaned for another reason (disliked it, needed the pen for something else, ink misbehaved).

Each refill is its own inking record — a fresh Start/End cycle — not a single record with its
date bumped forward.

**Cross-brand pairings are answerable without new modeling.** Using a pen with a different
maker's ink than its "own" is a genuinely different experience and is worth being able to report
on — but same-brand vs. cross-brand is just `pen.brand == ink.brand` computed at query time, not
a stored field. The broader "which brands of pen and ink do I actually favor together" analysis
is likewise a report generated from existing ledger data, not new schema.

**Raw refill frequency alone is a poor signal for "old favorite."** A workhorse desk pen and a
genuinely loved pairing can both show constant refills. The fix is explicit enjoyment (a rating,
see §6.1) outweighing raw frequency — a pairing refilled 5 times with a high rating should
outrank a workhorse refilled 50 times with no enjoyment signal. See §11 for why a separate
pen-role field to disambiguate this further was considered and dropped.

### 5.3 Nib as a standalone entity

Not a string on the pen. A nib has its own lifecycle:

- Size, material/karat, grind type, and custom name/description are all separate, queryable
  fields — never mashed into one free-text field the way FPC does it.
- A nib can be purchased on its own, with no originating pen (a spare, a custom-ground swap-in).
- A nib modification (sending it to a nibmeister for a grind) is itself a new purchase event
  attached to the nib, with its own vendor/date/price/currency. A nib's purchase history can have
  multiple entries over its life.
- Nibs move between pens over time; the pen↔nib relationship has installed/removed dates.

### 5.4 Purchase — one shared structure, with a per-entity history

Pens, inks, and nibs (including nib modifications) all share the same purchase structure:

| Field | Notes |
|---|---|
| Date ordered | Separate from delivery date — matters for pre-orders, bespoke pens, backorders |
| Date delivered | |
| Vendor | |
| Price | |
| Currency | Defaults to USD, easily overridden. No smart vendor-based inference. |

Explicitly excluded: shipping cost as a separate field, current/retail value, insurance
documentation.

**Ink and nib both carry a purchase *history*, not a single purchase.** A nib's history covers
original acquisition plus any later grind/modification work, each a separate purchase entry. Ink
is consumable in the same sense: a bottle runs dry and gets rebought. Each rebuy is a new
purchase entry on the *same* ink catalog record — not a new row, not an untracked fact. The count
of purchase entries on an ink doubles as "how many bottles of this color are actually on hand" —
a real inventory question that didn't have a home before. This is also where a bundled-with-a-pen
ink lands: a free bottle becomes a $0 purchase entry on the existing ink record if it's a known
color, or seeds a new ink record if it's genuinely new — see §5.7.

### 5.5 Ownership state

Replaces FPC's single `Archived` boolean, which conflates two different things:

- **Active** — in normal use or available for use. Shown by default.
- **Retired** — still owned, just not used or cared for. Hidden by default.
- **Rehomed** — sold or given away, no longer owned. Hidden by default. A freeform note covers
  the circumstances; no structured recipient/price-received fields needed.

All three states are preserved forever — nothing is ever deleted. Viewing retired/rehomed items
requires a deliberate action (a filter or explicit view), not something that appears by default.

A wishlist entry follows the same "preserved forever, hidden by default" pattern once converted
into a real catalog entry — see §5.7.

### 5.6 Tags

- Purely user-curated. The app never auto-generates tags.
- Used for ad hoc curation workflow — marking what's unused, what's a candidate to rehome — not
  a home for anything that's really a structured attribute.
- Filtering by tag is a first-class, high-priority feature, with mandatory AND/OR combination
  (not just one tag at a time).
- All first-class entities (pen, ink, nib — and any future entity like paper) get tagging as
  baseline functionality. It isn't re-argued per entity.
- Color family is a structured attribute on the ink, not a tag — it's a base property of the
  item, not a workflow marker.
- **"Old favorite" is itself a good tag candidate** — a hand-applied signal, the same kind of ad
  hoc curation as marking something unused, that the "give me an old favorite" AI suggestion
  (§6.7) can draw on alongside the ledger-computed signal, not instead of it.

### 5.7 Accessories, box, and bundled ink

Not first-class entities. A lightweight note on the pen ("came with: sleeve, pin; original box")
covers the practical need — knowing what should travel with the pen if it's ever rehomed.

**Bundled ink still doesn't need dedup-detection logic — the user keeps making that call by
hand.** He already decides whether a bundled color is new or a dupe of something he owns: dupes
go straight in a physical dupe box, new colors get their own ink catalog entry. What changes with
ink purchase history (§5.4): a dupe now becomes a $0 purchase entry on the existing ink record (so
the extra physical bottle is actually counted), rather than a note that dead-ends as prose. A
genuinely new color still gets its own catalog entry as before.

### 5.8 Canonical Brand and Line

Brand and Line are picked from a controlled list, with an explicit "Add new..." escape hatch —
not freeform text fields. Free-text entry lets the same brand exist under multiple spellings,
which silently corrupts any brand-level report (including something as basic as "which brands do
I only own one ink from"). A dropdown-plus-add-new keeps day-to-day entry just as fast (the
common case is picking something already used) while still allowing genuinely new brands without
a schema change. Applies to pens and inks both; Line follows the same pattern as Brand.

FPC import needs a one-time normalization pass to collapse existing spelling drift into a single
canonical list before this becomes the enforced entry method going forward.

---

## 6. Feature requirements

### 6.1 Inventory and ledger (core)

- CRUD for pens, inks, nibs with the attributes described in section 5.
- Brand and Line entry via controlled list + "Add new..." (§5.8) — not free text.
- Log inking events (Start/Mid-use/End) with checkboxes-plus-freeform-note for performance
  (flow, dry time, feathering/bleed, shading/sheen) and for cleaning-out reason.
- A simple 1–5 rating on an inking, in addition to notes — gives a cheap, explicit enjoyment
  signal that should outweigh raw refill count when surfacing "old favorites." This data capture
  is in scope for v1 regardless of whether the "hall of fame" dashboard view (§6.8) ships.
- Pen↔nib assignment history (installed/removed dates), independent of inking events.
- `Used` (ink) is a computed field — true once the ink has at least one ledger inking entry, not
  a manually-set flag. `Swatched` (renamed from FPC's `Swabbed`) is likewise computed — true once
  a swatch photo/composite (§6.5) actually exists for that ink, directly reflecting "every ink has
  a swatch" rather than a checkbox that can drift from reality.

### 6.2 Curation and filtering

- Tag-based filtering as a first-class, high-priority view, with AND/OR combination.
- Color family and other structured attributes (sheen, shimmer, shading, permanence) as
  filterable fields on inks — these are fixed properties of the ink, not per-use observations.

### 6.3 Bulk operations (confirmed need, primarily for ink)

- Multi-select on list views, with a bulk field-update action (e.g., set swatched/used across a
  batch of newly-arrived inks in one action).
- Must preserve list position/state after a save — FPC's biggest pain point here is losing scroll
  position after every single edit.
- Scope to pens/nibs not yet confirmed; revisit once those entities' real workflows are clearer.

### 6.4 Color similarity and near-dupe detection

Generalizes existing prototype tooling (`gen_inks.py` and related scripts) into a live, in-app
feature rather than a static, disconnected report:

- Convert ink hex values to CIE Lab; compute pairwise ΔE (Delta-E) across the collection.
- Bucket inks into color families (7 hue-based families + Neutrals & Grays).
- Per-ink uniqueness score (0–10): distance to nearest neighbor.
- Near-dupe clustering, with oversized clusters re-split at a tighter threshold.
- **Multiple browse views — Color Family, Color Wheel, Tone, Brand A–Z — are a highlight of the
  app, not incremental sugar.** These four are an easy way to reshuffle how the whole collection
  is seen, and are primary/day-one scope. **Near-Dupes is a second wave** — it serves a different,
  more analytical goal (dupe-avoidance/curation) than the reshuffling delight the other four
  provide.
- **Near-dupe clustering is stateless — no dismiss/acknowledge mechanism needed.** The concern
  was that resurfacing the same pair every visit would recreate the "disconnected report nobody
  acts on" failure this feature is meant to fix. But the actual use isn't pruning the collection
  (unlikely to happen) — it's browsing what's similar and catching "this is basically a color I
  already own" before buying another one. Recompute and show fresh each time; nothing to persist
  or dismiss per pairing.
- **Critical requirement: this data must live inside each ink's own record with an actionable
  next step attached** (tag it, add to wishlist, decide to rehome) — not a separate page that has
  to be remembered and revisited. This is the direct fix for why the prototype tooling never got
  used.
- Side-by-side comparison view: pull two or more specific inks up next to each other directly
  (distinct from collection-wide clustering).

### 6.5 Photos

- **Ink** — carry over the existing working pipeline as-is: a lightbox swatch photo, evaluated
  for a representative color; a colorimeter reading as a second data point; the ink's listed
  catalog value as a third; a composite image generated with all three overlaid as labeled color
  chips. Do not redesign this — it already works. **The label-reading step (identifying an ink
  name from a handwritten card) stays a manual Claude Code workflow, not an automated
  OCR/vision pipeline** — the cost of automating it would be small (usage-based API pricing at
  this volume), but not worth taking on for a step that already works, and a cheap non-LLM OCR
  library would likely be less accurate on handwritten labels than the current manual step.
- **Pen** — a photo per pen, evaluated *point-in-time*, not precomputed. FPC's `Color` field
  turns out to be the resin/material name (e.g. "Primary Manipulation 5.5"), not an actual color
  value, and custom artisan resins are often swirled/multi-tone anyway — there's no clean single
  value to derive ahead of time even if precomputing were worth it. Rather than a batch
  photo-extraction pipeline that stores a color or palette per pen, the aesthetic-pairing
  suggestion (§6.7) evaluates the pen's photo fresh at the moment of the ask — consistent with
  the grounding principle that AI re-derives from ground truth each time (§6.7). Nothing is
  extracted or stored per pen; the photo itself is the only asset that needs to exist.
- **Nib** — a photo per nib, likely similar point-in-time treatment to pens. Not yet designed in
  detail.

### 6.6 Before-you-buy workflow

- Given a URL to a candidate ink's product swatch image, download and evaluate the image for a
  color value, then run the same near-dupe comparison (6.4) against the existing collection.
- Fixed ink properties that are dislikes (heavy sheen/shimmer) should also factor into this check
  as a reason to pass, independent of color similarity.
- **Deprioritized to "someday," not v1.** The workflow depends on reliably finding and
  identifying a decent product image online for a given candidate — a shakier foundation than the
  controlled lightbox photos the rest of the color pipeline relies on. Worth keeping as a real
  want, not something to build until the core ledger/wishlist basics are proven out.
- **Wishlist**: a real feature for saving candidates, not just an ephemeral check — deliberately
  a speed bump against impulse buying. Saving something to sit and be reconsidered later is the
  point, not a shopping list. **Buying a wishlisted ink converts the entry, it doesn't start
  over** — modeled on an Amazon-list feel, the wishlist entry (name, brand, line, notes on why it
  caught his eye) carries forward into the real catalog record. The wishlist entry itself isn't
  deleted on conversion — same "preserved forever, hidden by default" pattern as ownership state
  (§5.5) — it drops out of the active wishlist view but stays queryable (e.g. "how many
  wishlisted inks actually get bought," "how long do things sit before I decide").

### 6.7 AI-assisted suggestions

**Two entry points**, matching how the actual decision moment works (pen selection is usually
physical/tactile; ink selection is where digital help is wanted):
- Pen already chosen, need an ink suggestion.
- Nothing chosen yet — suggest both pen and ink.

**A short interview, not a static recommendation**, nails down intent before suggesting anything:
- Favorite/proven pairing, or something new to experiment with?
- Color match/complement to the pen, or contrast ("go wild")?

**Response is always a short list, never a single confident pick** — a single suggestion reads as
being told what to do. This applies to both branches (favorite-match and experiment), though
experiment responses additionally need to be easy to regenerate with feedback.

**Choosing from the list creates the ledger Start entry directly**, in the same conversation —
handing back off to the physical world (gather pen/ink/nib, fill the pen) at exactly that point.

**Aesthetic pairing evaluates the pen's photo at the moment of the ask** (see §6.5) — no
precomputed color data to draw on; the suggestion flow reads the actual photo fresh each time.

**No proactive/unprompted suggestions.** Everything here is pulled on request, never pushed.

**Data accessibility is a first-class property.** The same data these suggestions draw from
(structured fields and freeform notes) needs to be natively and reliably accessible to Claude —
via an API, a skill, or similar — not locked inside the app's own UI. Both the app's own canned
dashboards (6.8) and Claude's access are two views onto the same underlying data.

**Grounding requirements** (from direct prior experience with unreliable AI output):
- Every AI-generated claim must trace back to specific source records — no assertion without a
  receipt.
- Structured-field facts are quoted directly; prose synthesis is visibly labeled as inference,
  never blended with the same authority as a direct fact.
- Sample size is always shown ("only used once, too early to tell" beats a confident guess from
  thin data).
- AI output is stored separately from the user's own entries — never overwrites or blends into
  what the user directly recorded, though AI may learn from both its own prior analysis and the
  user's entries.
- AI re-derives from ground truth each time rather than trusting a prior summary unchecked, so
  drift doesn't compound across reports.

### 6.8 Reporting

Canned in-app views, backed by the same data Claude can query:

- **Longest-untouched list** — pens and inks sorted by days-since-last-used. Serves the "use
  more" goal directly; doubles as the candidate pool for "something new" suggestions.
- **Currently-inked board** — everything loaded right now, at a glance.
- **Best-pairings "hall of fame"** — top pairings by rating. **Cut for v1** — depends on the
  rating field (§6.1) actually getting used consistently, which is unproven. The underlying data
  capture (the rating itself) stays in scope regardless; only the dashboard view is deferred.
  Easy to add later once there's enough rated history to mean something.

Explicitly excluded: an ink-color-distribution chart (how many reds vs. blues owned) — a fact to
look at, not a lever to pull; the same failure mode as the disconnected prototype tooling.

### 6.9 Nib storage location (open — not designed)

Loose nibs live in small snap boxes with film holders — good physical protection, poor
findability. Points toward tracking which box/slot a nib physically lives in, so a lookup
replaces digging through a box. Not designed yet.

### 6.10 Responsive / mobile

The app has to work well on a phone/iPad, not just desktop — responsive web, not a separate
native build. The real decision moment ("what should I ink next") is tactile and happens away
from any screen; the ink-suggestion follow-up needs to be usable right there, not only back at a
desktop. Some data or fields will likely be minimized or hidden on smaller screens; exact scope
of what stays visible on mobile isn't designed yet — just the requirement that phone/iPad use has
to be genuinely comfortable.

---

## 7. Data migration

- FPC export (CSV) is the starting inventory — import kickstarts the collection rather than
  starting from zero.
- **Brand/Line normalization pass required before canonical-list entry (§5.8) is enforced** —
  collapse existing spelling drift (e.g. "Pilot" / "PILOT" / "Pilot Namiki") into a single
  canonical list as part of import, not left for later cleanup.
- Backfill happens after import: nib detail, purchase structure, and anything else FPC never
  captured gets filled in over time, not required at import.
- Nib records on import: create a minimal record per pen (size only, parsed from FPC's free-text
  field where possible), enrich manually afterward.

---

## 8. Non-functional requirements

- **Backup is non-negotiable** — no data loss to corruption or failure. Treated as
  infrastructure, not a product feature to design in this document.
- **Export** — CSV/full export is a "someday," not a day-one requirement.
- Self-hosted, single-user — no auth complexity beyond a single owner account.
- **Responsive web, not just desktop** — see §6.10.

---

## 9. Success criteria (six months in)

- The FPC-equivalent daily habit (get a pen, log it; get an ink, log it) carries over with no
  added friction — including from a phone, not just a desktop session.
- Import + backfill actually gets done — but the real bar is higher than that: ledger entries
  keep getting logged as pens/inks/nibs get used, not just at initial entry.
- Nib findability improves via physical storage tracking.
- **Primary measure of success: more of the existing collection gets used, in preference to
  acquiring more.** This is the point of the AI suggestion features and the wishlist-as-speed-bump
  design — not a side effect of them.

---

## 10. Open questions

- Whether corrected/canonical hex per ink (overriding a vendor's published value with a
  measured one) deserves a real feature — a structured field plus in-app disagreement-flagging —
  or is out of scope. Birmingham Sea Holly is the concrete case pulling toward "build it": FPC's
  published value is genuinely wrong (not just imprecise), and the trustworthy correction should
  come from measured sources (colorimeter reading, other community swatch data) rather than an
  unverified manual guess.
- Whether bulk operations (6.3) are needed for pens and nibs, not just ink.
- Nib photo point-in-time treatment — "probably similar to pens," not discussed in further detail.
- Nib storage/location tracking (6.9) — not designed.
- The technical shape of Claude's data access (API, skill, or otherwise) — deliberately deferred
  until the product vision is settled.

---

## 11. Explicitly declined (considered and rejected, not overlooked)

- Multi-user, sharing, ink-swap matching, leaderboards, public-facing views.
- Proactive/unprompted notifications.
- Precise pen size/weight measurement.
- Current/retail value tracking, insurance documentation, shipping-cost line item.
- Bundled-ink duplicate-detection logic (the physical bottle is now countable via ink purchase
  history, §5.4/§5.7 — but the new/dupe judgment call itself stays manual).
- Ink-color-distribution chart as a dashboard view.
- **Pen-level "role" (dedicated/workhorse vs. rotation) as a dedicated field or feature.** Raised
  as a way to disambiguate refill-frequency signal from real enjoyment; dropped as an edge case
  not worth building — the enjoyment-rating signal (§5.1, §6.1) resolves the ambiguity on its own.
- **Cross-brand pairing as a modeled/stored dimension.** It's a computed comparison
  (`pen.brand == ink.brand`) at query time, not new data requiring schema investment (§5.2).
- **Automated swatch-label reading (OCR/vision).** Stays a manual Claude Code workflow — not
  worth even the small cost of automating it at this volume (§6.5).
- **Precomputed/stored pen color extraction.** Aesthetic pairing evaluates the pen photo
  point-in-time instead (§6.5, §6.7).
- **Best-pairings hall-of-fame dashboard, for v1** (§6.8) — the underlying rating data capture is
  still in scope; only the dashboard view is deferred, not rejected outright.
