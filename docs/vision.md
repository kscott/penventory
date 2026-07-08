# Penventory — Product Vision

The *why* and *what*, captured through an interview with Ken. The technical plan
(`project-plan.md`) is a separate, later concern — this document stands on its own
and should be finalized before revisiting the schema/stack.

---

## Why build this at all

**What FPC (Fountain Pen Companion) does well:** capturing inventory (pen basics, inks) and a
decent workflow for recording a fill event (pen + ink).

**What FPC lacks:**
- Pen attributes are shallow — not enough depth on what a pen actually *is*
- Reporting/analysis is almost non-existent — no way to look back across the collection
- No three-way combination — FPC tracks pen+ink, but nib isn't a first-class part of the
  "what's this experience like" question
- Tags exist but are nearly unusable for filtering, and FPC pollutes the tag list with its own
  auto-generated tags

**Single-user, explicitly.** "Multi user does nothing for me. This is one person's collection
and experiences." Possible future expansion to paper as a fourth tracked dimension, but not v1.

**Paper is too granular to structure for now.** No dedicated field or entity — if paper matters
for a given pairing, it goes in that pairing's freeform note, same as any other observation. Not
ruled out forever, just not worth a schema commitment yet.

---

## The core idea: three living ledgers, not a static catalog

Match pen + ink + nib together at the moment of use, capture how that specific combination
performs, and build ongoing ledgers rather than current-state snapshots:

- **Pen ledger** — everything it's been inked with and when, how each inking performed
- **Ink ledger** — every pen it's gone into
- **Nib ledger** — where it's been used, how it feels

**A ledger entry can be logged at any time, not only tied to an active pairing.** The pen (and
nib) ledger isn't just a log of inking events — it's a general timeline that can include a
standalone observation whenever something's worth recording (e.g. "how it feels / how it's held
up"), independent of whether the item is inked with something at that moment. Condition
(new/vintage/second-hand) is a static attribute captured once at entry; everything experiential
goes in the ledger.

**Cross-maker pairings are meaningful data, not noise.** Using a pen with a different maker's ink
than its "own" ink produces a genuinely different experience. Pen brand and ink brand should
support recognizing/reporting on same-brand vs. cross-brand pairings as a real dimension, not
just three anonymous IDs joined together.

**No dedicated modeling needed — this is a computed comparison, not new data.** Same-brand vs.
cross-brand is just `pen.brand == ink.brand` at query time; both fields already exist on their own
records. Same goes for the broader analysis this enables — which brands of pen and ink Ken
actually favors together, and why — that's a report generated from existing ledger data, not a
new schema field or stored relationship.

### Refills, pen role, and what "old favorite" actually means

**Each refill stays its own inking record** — matches the ledger philosophy: every fill gets its
own Start/End/why-it-ended cycle, not a single record that just gets its date bumped.

**Raw refill frequency is an ambiguous signal on its own, and shouldn't be trusted alone.** A
desk pen dedicated to daily data entry and a pairing Ken genuinely loves would both show constant
refills — one's a job assignment, the other's real enjoyment, and conflating them would make
"old favorite" suggestions meaningless. Originally this raised the idea of a pen-level "role"
(dedicated/workhorse vs. rotation) to disambiguate the two — **dropped, on reflection it's an
edge case, not worth building as a feature.** The fix that's actually worth having:

- **Explicit enjoyment should outweigh raw frequency.** If Ken's actually recorded that he loves
  a pairing (via rating and/or notes — see checkboxes+freeform pattern below), that signal should
  carry more weight toward "old favorite" than refill count by itself. A workhorse combo refilled
  50 times with no enjoyment signal shouldn't outrank a pairing refilled 5 times that Ken has
  explicitly rated highly. This alone resolves the ambiguity well enough — no pen-role tracking
  needed on top of it.

### Event lifecycle for an inking

- **Start** — recording pen + ink + nib matched together
- **Mid-use (sometimes)** — an experience note partway through, if something's notable
- **End (the real reflection point)** — most likely captured at cleaning-out time. *Why* it
  ended matters: ran dry naturally (a real signal it worked) vs. cleaned for another reason
  (disliked it, needed the pen, ink misbehaving, etc.) — these are different signals, not one
  bare `cleaned_on` date.

### Repeating design pattern: checkboxes + freeform note

Applies wherever Ken records an experience or outcome — not a one-off:
- **Performance notes** (flow, dry time, feathering/bleed, shading/sheen, etc.) — checkboxes for
  the basics, open space for what did/didn't work
- **Cleaning-out reason** — checkboxes for common cases (ran dry, didn't like it, needed the
  pen, ink issue) plus a freeform note

---

## Nib is a standalone, first-class entity

Not a string on the pen — its own thing with its own lifecycle. The pen↔nib relationship starts
at purchase (a pen usually arrives with a stock nib), but from there:

- Nibs can be modified (custom grinds) independent of the pen
- Nibs can be purchased entirely on their own (a spare, a custom-ground swap-in), no originating
  pen at all
- **A nib modification (sending it to a nibmeister for a grind) is itself an additional purchase
  event attached to that nib** — a nib's history can include multiple purchase records over its
  life (original acquisition, then later grind/modification work), each with its own vendor,
  date, price, currency

**Everything FPC mashed into one free-text Nib string needs to be its own standalone field** —
size, material/karat, grind type, custom name, etc., all separate and queryable.

---

## Canonical Brand and Line — controlled lists, not free text

Confirmed real problem: free-text Brand (and Line) entry lets the same brand exist under
multiple spellings ("Pilot" / "PILOT" / "Pilot Namiki"), which silently corrupts any
brand-level report — including basic ones like "which brands do I only own one ink from."

**Fix: Brand and Line are both picked from a controlled list, with an explicit "Add new..."
escape hatch** — not freeform text fields. This keeps day-to-day entry just as fast (pick from
what you've already used, which is the common case) while still allowing genuinely new brands
without a schema change or admin step. Applies to pens and inks both; Line follows the same
pattern as Brand.

FPC import needs a one-time normalization pass to collapse existing spelling drift into a
single canonical list before this becomes the enforced entry method going forward.

---

## Purchase: one shared structure across pens, inks, and nibs

Confirmed shared, not three copies of the same fields. Fields needed (FPC only has a flat Price):
- Date of purchase (ordered) — separate from date of delivery (arrived), since these differ for
  pre-orders, custom/bespoke pens, backorders
- Vendor
- Price, with currency

**Currency: pre-filled USD, easy override — not worth over-building.** Ken is almost always
charged in USD; when he's not, he already knows the currency at entry time. A vendor-linked
smart-inference system would be more background complexity than it's worth — a static default
beats a "smart" one here.

**Explicitly declined, surfaced by looking at a competing tool (Jon Rosen's FPN inventory
database):** shipping cost as a separate line item, insurance/replacement-value documentation,
and current/retail value tracking. Not wanted — current value specifically would require ongoing
research effort (tracking what things are worth over time) that Ken has no interest in doing.
Purchase price + vendor + date is the full extent of what's wanted here.

**Ink gets a purchase *history*, same pattern as nib modifications — not a single purchase.**
Ink is consumable: a bottle runs dry and Ken buys another of the same color. That's a second
purchase event on the *same* ink catalog record, not a new row and not a fact with nowhere to
live. Each purchase entry (vendor, date, price, currency) stacks onto the ink's history, and the
count of purchase entries doubles as "how many bottles of this color do I actually have" —
answering a real inventory question (multiple-bottle backstock) that didn't have a home before.
This also gives the bundled-ink case (see Accessories/bundled ink below) a real place to land: a
free bottle that comes with a pen is just a $0 purchase entry on the existing ink record, not a
separate untracked note.

---

## Pen attributes: what's actually missing from FPC

Reviewed FPC's pen export (18 fields, 276 pens) to jog memory: Brand, Model, Nib (mashed
free-text), Color, Material, Trim Color, Filling System, Price, Comment (doing double duty as
purchase source/date/notes), Archived/Archived On, Date Added, plus FPC-computed usage stats
(Usage, Daily Usage, Last Inked/Cleaned/Used, Inked flag) that Penventory's real ledgers replace.

Landed on:
- **No interest in precise size/weight measurements.** A rough size category is enough — pocket
  pen, roughly-standard-size (most pens), bigger/oversized.
- **Condition** (new/vintage/second-hand) — static attribute, captured once at entry.
- Nib and purchase data pulled out into their own first-class structures (above).

---

## Ink: mostly well-covered by FPC, but a few real gaps

Reviewed FPC's ink export too (255 inks): Brand, Line, Name, Type, Color, Maker, Swabbed, Used,
Archived/Archived On, Comment, Private Comment, a standalone `Private` flag, Tags, Date Added,
plus FPC-computed usage stats.

- **Bundled inks create duplicate catalog entries.** Some pens ship with an ink included (e.g.
  Leonardo's house ink) — Ken has been entering each arrival as a new ink record, producing many
  duplicates of what's actually the same ink product. Needs a way to recognize "I already have
  this" rather than creating a new catalog row each time.
- **Drop the public/private notes split, and drop the standalone `Private` flag.** Doesn't make
  sense for a single-user app — one notes field.
- No price/vendor/purchase date at all in FPC — same purchase-section gap as pens, just less
  visible because ink is otherwise in better shape.
- **`Used` and `Swatched` (renamed from FPC's `Swabbed`) both become computed, not manually-set
  flags.** `Used` is true once the ink has at least one ledger inking entry — no separate flag to
  remember to update, the ledger is the single source of truth. `Swatched` is true once a swatch
  photo/composite (see Photos, §6.5-equivalent below) actually exists for that ink — directly
  reflects Ken's real goal ("every ink has a swatch") rather than a checkbox that can drift out of
  sync with whether the photo was actually done.
- **Sheen, shimmer, shading, and permanence are fixed properties of the ink itself** — not a
  per-inking observation, confirming the old plan's model on this point (not the checkbox+note
  pattern used elsewhere for experiential things). Worth recording because they're actionable:
  Ken actively dislikes heavy sheen/shimmer and avoids buying inks with it, and shading is
  otherwise worth capturing as a real attribute. This should factor into the before-you-buy
  workflow too — a candidate ink with heavy shimmer is a reason to pass, independent of whether
  its color is a near-dupe of something already owned.

---

## Accessories, box, and bundled ink: a reminder, not an entity or a dedup system

Special-edition pens sometimes arrive with a sleeve, pin, or other accessory bundled in, and
separately, original boxes are easy to lose track of over time. Neither needs its own
first-class entity (unlike nib) — it's a lightweight "this pen came with X, in box Y" reminder
attached to the pen. The purpose is practical: knowing what to include if the pen is ever
rehomed, not building out inventory/history for the accessories themselves.

**Bundled ink (e.g. Leonardo pens shipping with a bottle) still doesn't need dedup-detection
logic — Ken keeps making that call by hand.** He already checks whether a bundled ink color is
new to him or a dupe of something he owns: dupes go straight in a physical dupe box, new colors
get their own ink catalog entry. What changes with ink purchase history (above): once Ken's made
that call, the bundled bottle isn't just a note anymore — a dupe becomes a $0 purchase entry on
the existing ink record (so the extra physical bottle is actually counted), and a genuinely new
color still gets its own ink catalog entry as before. The pen still carries a lightweight "came
with a bottle of [color]" reminder either way; the difference is that reminder now links to a
real inventory fact instead of dead-ending as prose.

## Ownership state: active / retired / rehomed

FPC's single `Archived` boolean conflates two different things. Split:

- **Retired/inactive** — still owned, just not used or cared for anymore (real for some pens:
  own it, don't reach for it)
- **Rehomed** — sold or given away, no longer owned

**Both stay in the collection's data — full history preserved, never deleted — but excluded from
normal/default display.** Seeing them requires a specific, deliberate action, not something that
shows up by default. For rehomed items, a freeform note is sufficient — no need for structured
recipient/price-received fields. The same "gone but preserved, hidden unless asked for" rule
would likely apply to a fully emptied ink bottle too, though Ken's skeptical that actually
happens in practice ("it may be a myth").

---

## Backup and export: mostly a technical concern, not a vision one

**Backup is a real, non-negotiable requirement** — Ken doesn't want to lose data to corruption or
any other failure — but it's infrastructure, not product vision; belongs in the technical plan,
not a feature to design here. **Export is a "maybe, not day one"** — lower priority, deferred
rather than dropped.

---

## Reporting: canned views in-app, same data reachable by Claude

Basic reporting is wanted as real in-app views, not just something to ask Claude for on demand.
**But the same underlying data has to be accessible to Claude too, not locked inside the app's
own UI.** Both surfaces matter; this isn't an either/or. Reinforces the "data accessibility to
external tools is a first-class property" principle already scoped in AI-assisted features below
— the canned dashboards and Claude's access should be two views onto the same data, not two
separate implementations.

**Checked FPC (the actual app) for dashboard ideas — most of it doesn't earn a spot.** FPC has an
ink-color-distribution chart (how many reds vs. blues you own); rejected as the same failure mode
already diagnosed with `gen_inks.py` — a fact to look at, not a lever to pull. Confirmed worth
keeping, both tied to things already settled as priorities:
- **Longest-untouched list** — pens and inks sorted by days-since-last-used. Directly serves
  "use more, not acquire more": it's the candidate pool for the "something new" AI suggestion,
  made visible without having to ask for it.
- **Currently-inked board** — everything loaded right now, at a glance. Plain and referenceable,
  used constantly rather than admired once.
- **Best-pairings "hall of fame", by rating — cut for v1.** Depends on the rating field
  actually getting used consistently over time, which is unproven. **The underlying data capture
  stays** — the 1-5 rating on an inking is part of the base ledger feature regardless (see
  Refills/pen role section) — only the dashboard view built on top of it is deferred. Easy to add
  once there's enough rated history for it to mean something.

**Side-by-side ink comparison is a want** — pulling two (or more) specific inks up next to each
other directly, distinct from the collection-wide near-dupe clustering. Ken didn't know FPC could
do this and called it out as genuinely interesting once surfaced.

**Social features (ink-swap matching, leaderboards, public ink list) are explicitly declined —
social itself has never been the interest.** The only reason Ken ever touched FPC's social side
at all: it was the path to someone else's color-bucketing analysis, used to decide how to
physically arrange ink swatches by group. That underlying need is already fully covered by
Claude doing the same analysis on demand (and by `gen_inks.py`'s existing color-family bucketing)
— no social layer required to get it.

---

## Bulk operations — a real, confirmed need

Concrete FPC pain point: inks often arrive in batches (six at once isn't unusual), or go
unswatched for a stretch and need catching up all at once. FPC has no bulk select — every ink
gets edited one at a time, and **the list view loses your scroll position after each save**,
so working through a batch means re-finding your place over and over. Ken wants to select a
group and set shared field values (swatched, used, etc.) across all of them in one action.

**Shows up most with inks.** Not yet confirmed whether pens or nibs need the same bulk-edit
treatment — arrival patterns for those are more one-at-a-time, so it may be ink-specific, but
worth revisiting once the other entities' real workflows are clearer.

---

## Tags: real discussion, FPC gets it wrong two ways

- Filtering a list by tag is nearly impossible in FPC — this should be **job one**, a
  first-class filter, not bolted onto search as an afterthought.
- FPC auto-generates a ton of its own tags that pollute the tag list — Penventory should not do
  this; tags stay purely user-curated.
- **AND/OR combination is always needed** when filtering by tag — single-tag-at-a-time isn't
  sufficient.

**What tags are actually for, in Ken's own use:** curation workflow — marking what's unused, what
he's willing to part ways with. Ad hoc, personal, evolving categories that don't deserve a
dedicated schema field.

**"Old favorite" is itself a good tag candidate.** Rather than only computing it from rating +
refill history (see Refills/pen role above), Ken tagging a pairing/ink/pen "old favorite" directly
is the same kind of ad hoc curation as marking something unused — a real signal, hand-applied,
that the "give me an old favorite" suggestion (see AI-assisted features below) can draw on
alongside the computed signal, not instead of it.

**Nibs get tags too.** General principle, not a one-off: first-class entities all get the same
basic functionality around them. Since nib is first-class alongside pen and ink, it inherits
tagging (and, by the same logic, anything else treated as baseline functionality for the other
two) rather than needing each capability re-argued per entity. **Same principle would extend to
paper/notebook**, if that ever becomes a tracked first-class entity (see the "possible future
expansion to paper as a fourth dimension" note above) — not a decision to build it, just
confirming the rule would apply the same way if it happens.

**Color family was being mis-modeled as a tag.** It should be a real structured attribute on the
ink (combinable with other filters), not a tag — tags are for workflow/curation, not for things
that are really a base attribute of the item.

---

## Color similarity — already prototyped, use it as the spec

Ken pointed at this folder's existing Python/HTML tooling — built against
the FPC export, already solving a real version of "find inks similar to this one," to
generalize into the app rather than redesign from scratch:

- `gen_inks.py` → `collected_inks.html`: converts every ink's hex to **CIE Lab** (proper
  perceptual color space) and computes pairwise **ΔE** (Delta-E, the standard perceptual
  color-difference metric) across the whole collection — not naive RGB/hex distance.
- **Color family bucketing** by hue/saturation/lightness into 7 families (Reds & Burgundies,
  Oranges & Browns, Yellows & Olives, Greens, Teals & Cyans, Blues, Purples & Pinks) plus
  Neutrals & Grays.
- **Per-ink uniqueness score** (0–10): distance to its single nearest neighbor in the whole
  collection — "how distinct is this ink from everything else I own" as a real computed number.
- **Near-dupe clustering**: groups inks within a ΔE threshold, re-splits oversized clusters with
  a tighter threshold, labels pairs "Nearly identical / Very similar / Similar / Noticeable."
- **Multiple sort/browse views**: Color Family, Color Wheel (pure hue order), Tone
  (Dark/Medium-Dark/Medium/Light/Pastel), Brand A–Z, Near-Dupes — plus live search and filters.
  **These four (Color Family, Color Wheel, Tone, Brand A–Z) are a highlight of the app, not
  incremental sugar** — an easy way to reshuffle how the whole collection is seen, core to the
  ink-browsing experience itself. Sequencing: **these four are primary/day-one; Near-Dupes can be
  a second wave** — it serves a different, more analytical goal (dupe-avoidance/curation) than
  the reshuffling delight the other four are about.
- `winnow-blues.py` — same idea narrowed to one hue range, built to help decide on blue-ink
  purchase candidates.
- Also in that folder: `compare_colorimeter.py` (FPC hex vs. colorimeter-measured hex, sorted by
  ΔE) — relevant to the color-accuracy theme in the old technical plan's Phase 6.

This is close to feature-complete for ink similarity/dedup already. **Ken hasn't actually acted
on it yet — and now has a specific diagnosis why.** The output is four standalone HTML files with
no connection to anything else — no link back to a specific ink record, no action to take, no
persistent state. Ken's own framing: he treated it as "vision-casting of what is possible, not a
call to do something." The analysis itself isn't the missing piece — disconnection from a live
system with real consequences (a tag to set, a wishlist to update, a decision to record) is.
Surfacing this *inside* the app, tied to the curation-tag workflow above, isn't just a nice
integration — it's the specific fix for the exact failure mode that already happened once.

No pen equivalent exists yet — makes sense, pens don't have ink's continuous color space to
cluster against, though material/color could support some "similar pens" notion later.

**No dismiss/acknowledge state needed for near-dupe pairs.** Considered whether resurfacing the
same pair on every visit would recreate the original "disconnected report nobody acts on"
failure — but Ken's actual use of this feature isn't pruning the collection (he's unlikely to
use the app to actively pare it down). The real use is browsing what's similar and, mainly,
catching "this is basically a color I already own" before buying another one. That's a stateless,
on-demand question — recompute and show the clusters fresh each time; nothing to persist, dismiss,
or store per pairing.

---

## Photos

**Ink: existing workflow, already happy with it — carry it into the app as-is.**
- Swatch on consistent paper, photographed in the lightbox.
- That swatch photo is evaluated for a representative color value.
- A colorimeter reading gives a second data point.
- FPC's own listed value gives a third.
- A composite image is generated: the swatch photo with overlays of all three color values.

This is a working pipeline today (`compare_colorimeter.py` and related tooling in this folder
implement pieces of it) — Penventory's job is to bring it into the app, not redesign it.

**Pens: a photo of the pen, evaluated point-in-time, not precomputed.** The pen's `Color` field
(carried over from FPC) turns out to just be the resin/material name — e.g. "Primary Manipulation
5.5" — not an actual color value, and custom artisan resins are often swirled/multi-tone anyway,
so there's no clean single value to derive ahead of time even if it were worth precomputing.
Rather than building a batch photo-extraction pipeline that stores a color (or palette) per pen,
the aesthetic-pairing suggestion (see AI-assisted features below) evaluates the pen's photo fresh
at the moment Ken asks for a match — same "re-derive from ground truth each time" principle
already settled for AI suggestions generally. Nothing extracted or stored per pen; the photo
itself is the only asset that needs to exist.

**Nibs: photo wanted too, likely similar treatment to pens.** Not yet worked out in any detail.

**Looked closer at the existing tooling behind the ink workflow** — `swatch_extract.py` is the
actual composite-overlay tool (auto-detects the swatch in the lightbox photo, white-balances,
extracts a representative color, stacks labeled "Photo / Colorimeter / FPC" chips onto the
image) — this is the per-ink workflow step described above. `compare_colorimeter.py` is a
separate, second-order QC pass: batch-compares colorimeter vs. FPC hex across the whole
collection and flags big disagreements (ΔE ≥ 20) for rescan — not something run per new ink, a
periodic audit.

Sitting alongside both is `ink_corrections.py`, a small hardcoded table of cases where Ken's
decided FPC's published hex is just wrong and overridden it with a corrected value (verified
against InkSwatch or a physical swatch). **Open and genuinely unresolved:** whether this needs a
real feature — a first-class "corrected hex + reason" field per ink, with the rescan-flagging
logic built into the app instead of a manual script run — or whether it's really just Ken's own
perfectionism about a vendor value not matching his own real-bottle-on-real-paper swatch, not
something the product needs to formalize.

**Concrete case tilting toward "this is real":** Birmingham Sea Holly. FPC lists `#7b8190`
(grayish) — genuinely wrong, not just imprecise: Ken's colorimeter reading is `#537A95`, a clear
steel blue, nowhere near FPC's gray. The hardcoded correction in `ink_corrections.py` (`#4a6885`)
is **not** a rigorous value despite its code comment claiming an InkSwatch source — Ken's own
words: "total pull a value out of my ass, there is nothing scientific about it." The actual
trustworthy data point here is the colorimeter reading, which nobody's using as the correction
today.

That reframes the open question: if this becomes a real feature, the "corrected" hex shouldn't be
a freeform value Ken eyeballs — it should be grounded in one of the measured sources already
being captured (colorimeter reading, or the swatch-photo-extracted color), not a fourth
number invented from memory. Still undecided whether to build it at all, but if built, it should
tie to measured data, not add another manual guess on top of the ones already causing the
problem.

**More external grounded sources are welcome, not just the colorimeter.** The old technical plan
already flagged InkSwatch.com by name — its swatch-derived hex for Sea Holly is visibly blue,
matching the colorimeter, while FPC's manufacturer-spec value is wrong. Ken's response broadens
this further: alternate community color data sources generally are good to have — Mountain of
Ink and Fountain Pen Network (FPN) named alongside InkSwatch as other candidates. "Data is good"
— the more independently-sourced swatch data cross-referenced against the colorimeter reading,
the more confidence in a corrected value if this ends up getting built.

---

## Before-you-buy workflow

When Ken's eyeing a new ink, he typically has a product page with a swatch image online — not a
hex value or a physical sample. The workflow: give the app the swatch image's URL, it downloads
and evaluates the image for a color value, then runs the same near-dupe/similarity comparison
used for the existing collection (see Color similarity above) against inks he already owns. Goal:
catch "this is just another steel blue" before buying it, not after.

**Deprioritized to "someday," not v1.** The whole workflow depends on reliably finding and
identifying a decent product image online for a given candidate ink — that's a shakier
foundation than it first looked (unlike the controlled lightbox photos the rest of the color
pipeline relies on). Worth keeping in the vision as a real want, but not something to build until
the core ledger/wishlist basics are proven out.

**Wishlist is a real, wanted feature — not just a query tool.** Saving a candidate ink to a
wishlist (rather than only doing an ephemeral one-off check) is deliberately a speed bump against
impulse buying — a place to park something and let it sit before deciding, not just a shopping
list.

**Buying a wishlisted ink converts the entry — it doesn't start over.** Modeled on an Amazon-list
feel: the wishlist entry (name, brand, line, color check, notes on why it caught his eye) carries
forward into the real ink catalog record when purchased, rather than re-entering everything from
scratch. The wishlist entry itself isn't deleted on conversion — same "preserved forever, hidden
by default" pattern as ownership state (§5.5): once converted, it drops out of the active wishlist
view but the data still exists to ask questions against or build stats from (e.g. "how many
wishlisted inks actually get bought," "how long do things sit before I decide").

---

## The real decision moment: a physical-browsing story, not a screen

Walked through an actual instance of "I want to use something different": the trigger is a vague
felt itch, not a specific pen in mind — sometimes provoked by a new arrival, sometimes just
enough time since the last change. **The itch gets resolved by physically browsing the
collection and seeing what resonates** — not by opening FPC, not by looking anything up. "It
never happens in FPC." Pen gets chosen first, purely physical; ink is decided after, once the pen
is in hand.

This matters for the AI pairing/suggestion features scoped below: if the actual decision moment
is tactile and happens away from any screen, a suggestion engine can't simply *replace* that
browsing — it has to find a way into a process that currently has no digital component at all.

**Directly implies the app has to work well on a phone/iPad, not just desktop.** Responsive web —
same app, adapting to screen size, not a separate native build. Some data or fields likely get
minimized or hidden on smaller screens rather than crammed in; exact scope of what stays visible
on mobile isn't designed yet, just the requirement that phone/iPad use has to be genuinely
comfortable, not just technically functional.

**Found the actual entry point: the ink half of the decision, after the pen's already in hand.**
Pen selection stays purely physical/instinctive — no digital help wanted or useful there. But once
the pen is chosen, Ken confirmed this is exactly where suggestion help would be genuinely
welcome, in the form of a short interview rather than a static recommendation:
- New pairing (untested with this pen) vs. reach for something proven?
- Color match/complement the pen's own color, or go wild with contrast?

This gives concrete shape to the "no proactive nagging, pulled not pushed" principle below and to
the pairing-suggestion intents already scoped in AI-assisted features ("old favorite" / "something
new" / aesthetic match) — the trigger is Ken already holding a chosen pen and wanting the *ink*
half narrowed down through a couple of quick preference questions, not a dashboard he has to
think to open.

**Second entry point: the pen choice itself can be handed over too.** Not always "pen physical,
ink digital" — sometimes Ken shows up with "I want a different pen, what's on tap?" and wants
the pen suggested as well, not just the ink. So the suggestion flow needs to work from either
starting point: pen-in-hand-need-ink, or nothing-in-hand-suggest-both.

**Response shape: never a single confident pick, either branch — always a short list.** Both the
favorite-match and the experiment/something-new answers come back as a couple of options, not one
answer handed down. Ken's own framing: "I have a bad case of 'don't tell me what to do.'" A
single suggestion reads as being told what to do; a short list reads as being given real options
to choose between — same underlying data, very different feel. Experiment responses additionally
need to be easy to regenerate with feedback (react, get another pass); favorite-match responses
are more stable/proven so probably don't need the same regenerate loop, but should still land as
options, not a verdict.

**Story closes the loop here: picking from the list creates the ledger entry, then Ken goes and
does the physical thing.** Choosing a pairing from the suggested options is what triggers the
**Start** event already described in the ledger lifecycle above (pen + ink + nib matched
together) — the entry gets made right there in the conversation, at the moment of choosing, not
after the fact. Then it's purely physical again: gather pen, ink, nib; fill the pen. The
suggestion flow's whole job is to get Ken from "itch" to "a logged Start entry," handing back off
to the physical world at exactly that point.

---

## How the app surfaces things: no proactive nagging

**Explicitly not wanted: apps that pop up unprompted with "you should do X."** That's an
annoyance, not a nudge. What Ken actually wants is specific, relevant information delivered in
the form he needs, at the moment he needs it — pulled, not pushed.

**The likely moment of need is inside a Claude session, not the app's own UI.** Ken expects he'll
often be talking to Claude when the "what should I ink next" or "is this a dupe" question comes
up — which means Claude needs native, reliable access to Penventory's data (API, a skill,
something) and has to get it right, not guess. The technical shape of that access (API vs. skill
vs. something else) is deliberately not being decided yet — Ken wants to work through the story
of what someone actually does with the app first, before touching how it's built.

---

## AI-assisted features

**Pairing suggestions — a real, wanted feature, with distinct intents:**
- "Give me an old favorite" — surface something proven
- "I want to try something new" — novelty-seeking, favor unused/rarely-used combos
- "Find a better match for this ink" — given an ink, suggest the ideal pen + nib
- Aesthetic pairing — pick an ink whose color complements or matches the pen itself, not just a
  performance-based match

**Data accessibility to external tools is a first-class property**, not just the app's own
built-in views. Freeform notes are reportable too, given the right access — an LLM can extract
patterns from prose that a checkbox scheme would've had to anticipate in advance. The checkboxes
are still worth having (fast to log, directly filterable without AI in the loop), but prose isn't
second-class data.

**Hard boundary: AI-derived content stays strictly separate from what Ken enters himself** —
this is about storage/provenance, not a restriction on what AI can learn from. Ken's own
notes/ratings/checkboxes are never overwritten by or blended into AI output. AI *is* allowed to
learn from its own prior analysis as well as from Ken's entries — the separation is about never
confusing "what Ken said" with "what Claude inferred."

**Grounding principle — how AI avoids hallucination.** Ken's had direct experience with AI
hallucination being unpredictable ("impossible to guess where it will happen"), so this is a real
requirement:
- Every AI-generated claim traces back to specific source records (which inkings, which dates,
  which notes) — no assertion without a receipt.
- Structured-field facts are quoted directly; prose synthesis/pattern-spotting is visibly labeled
  as inference, never blended into fact with the same authority.
- Sample size is always shown — "only used once, too early to tell" beats a confident-sounding
  guess from thin data.
- AI can build on its own past analysis, but re-derives from ground truth each time rather than
  trusting a prior summary unchecked — so drift in one report doesn't silently compound into the
  next.

---

## Build sequencing: visuals first, ledger/AI second

Confirmed while deciding whether this is worth building as a full app at all: it is, because the
visual browsing experience (§6.4's four highlight views — Color Family, Color Wheel, Tone, Brand
A–Z) is itself a source of joy, independent of any ledger or AI suggestion — "the colors of the
pens, the shades of the ink... I want to see them intermingled, shuffled into new pairings."
That's inherently a UI thing, not a data-query-via-Claude thing.

That reframes the build order:

1. **Visuals first.** A basic database — nothing earth-shaking, just enough structure to store
   pen/ink/color data — backing a real visual layer that lets the collection be browsed and
   reshuffled. Low risk: doesn't depend on any new logging habit, doesn't decay if untouched for
   a while, and the payoff (enjoying looking at the collection) is immediate once it exists.
2. **Tune the visuals.** Get the browsing experience actually good before moving on.
3. **Then the interactive/ledger/AI-suggestion layer** — the harder, less-proven part (ongoing
   ledger entries, purchase history, AI-mediated suggestions at the tactile decision moment)
   comes after the foundation is real and already being enjoyed, not before.

Also part of this decision: **the self-hosted-app cost is lower than it looks because the infra
already exists** (homelab, Docker hosts) — this isn't starting from a bare server. And more
broadly, for a personal project like this, "is the engineering effort worth it" isn't answered by
pure utility math alone — building it is itself part of the payoff, reconnecting with the joy of
using tech to accomplish something he cares about. The real risks worth watching are execution
ones (does it get finished, does ledger friction kill sustained use of the second phase) — not
whether the time is justified up front.

---

## Six months in: what success looks like

- **Daily habit carries over from FPC unchanged** — get a pen, enter it; get an ink, enter it.
  The app needs to support that same low-friction capture-on-acquisition pattern, not just backend
  structure.
- **FPC import kickstarts the inventory**, with backfill after — bring in what FPC already has,
  then go back and fill in the gaps FPC never captured (nib detail, purchase structure, etc.).
- **Real success is motivation, not just data migration.** Getting the import and backfill done
  is one bar; actually staying motivated enough to log ledger entries — evaluations as pens/inks/
  nibs get used, not just static catalog rows — is the bar that actually matters. The ledger
  concept only pays off if entries keep happening.
- **Better physical organization of the collection**, specifically nibs: loose nibs currently live
  in small snap boxes with a film holder each — good protection, but finding a specific one means
  digging through a full box. Not yet designed, but points toward the app tracking *where* a nib
  physically lives (which box/slot) so a lookup replaces the digging.
- **Using more of the collection, not defaulting to habit — and this is the priority, not
  cataloging more.** Ken's real pattern today: grab whatever case is closest, reach for a
  favorite Iroshizuku color. Six-months-success means something nudges him out of that groove
  more often. This directly validates the "I want to try something new" novelty-seeking pairing
  suggestion already scoped in AI-assisted features below — it's not a hypothetical nice-to-have,
  it's the actual behavior change Ken's hoping the app produces.
- **Explicitly: use more, not acquire more.** Ken's already improved on purchasing discipline
  this year, and sees using more of what he already owns as reinforcing that further — not a side
  effect, the point. This is the same spirit as the wishlist-as-speed-bump idea above: the app's
  job is to make the existing collection more satisfying to use, not to make acquisition easier or
  more frequent.

---

## Open / not yet resolved

- **Nib photo processing** — wanted, "probably similar to pens" (point-in-time evaluation, see
  Photos section) but not discussed in any further detail.
- **Nib storage/location tracking** — points toward the app tracking which box/slot a loose nib
  physically lives in, so lookup replaces digging through snap boxes. Raised under six-months
  success above; not designed at all yet.
- **Corrected/canonical hex per ink** — see Photos section above. Genuinely undecided whether
  this deserves a real feature (structured override field + in-app rescan-flagging) or is just
  Ken's own perfectionism about vendor values, not something to formalize. Sea Holly (Birmingham)
  is the live example pulling toward "real" — FPC's value isn't just slightly off, it's a
  materially different color from the actual ink.
- **Bulk operations for pens/nibs** — confirmed need for inks; unconfirmed whether pens or nibs
  need the same bulk-select/bulk-edit treatment.
