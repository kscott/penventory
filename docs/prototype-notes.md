# Prototype notes — decisions from the ink-collection static pages

`~/Notes/personal/ink-collection/` holds a set of Python-generated static HTML
pages built against the FPC export. It is the working prototype for Penventory's
**visual browse** (Phase 2) and **ink show page** (Phase 3), and increasingly
the place UI/UX decisions get made before they're built for real. This doc
records those decisions so the phase plans don't have to re-derive them.

Not a status doc — see `punch-list.md` / the phase plans for state. This is
"what the app should do, learned by building a rough version first."

---

## Color science (feeds `vision.md` §"Color similarity" and Phase 2/4)

- **CIEDE2000 everywhere.** CIE76 (plain Euclidean Lab distance) is gone from
  every rendered number as of 2026-09-07 — it overstates distance among
  saturated colors and understates it near neutral. `ink_lib.delta_e2000` is
  the metric; `delta_e` (CIE76) survives only as a non-default option.
- **Near-dupe clustering** (`chroma_context_linkage_clusters`): min-chroma-
  context CIEDE2000 — the SC (chroma-scaling) term is driven off the *minimum*
  chroma across a candidate merge group, not the pair's own average, so a
  saturated group member can't "buy down" a near-neutral candidate's apparent
  distance. Two-tier: nearest-neighbour ≤ 17.5 **and** whole-group diameter
  ≤ 20. This is the "does this ink already have a match in the collection"
  answer — one fixed partition, computed once, same everywhere it's shown.
- **"Reads like"** (on an ink's own page) is a *different, tighter* thing:
  direct pairwise CIEDE2000 ≤ **4.5** to the ink itself, closest first. The
  near-dupe supercluster (diameter 20) is deliberately generous and pulls in
  colors that don't actually read alike — wrong for "what could I confuse this
  with." If nothing clears 4.5, the section is omitted, not captioned.
- **Uniqueness score** (0–10 on the collection page): the CIEDE2000 ΔE to the
  ink's single nearest neighbour, capped at 10. 0 = a near-identical twin
  exists; 10 = nothing within ΔE 10.
- **Dupe / Close vocabulary**: `ink_lib.category(de)` — `Dupe` below ΔE 4,
  `Close` from 4 to 8. One boundary, one word-set, wherever a match is labelled.
- **Colour families**: LCh hue/lightness/chroma windows, **deliberately
  overlapping** at ambiguous edges (a red-violet is legitimately on Reds *and*
  Purples). A handful of per-ink include/exclude overrides; Pastels is a
  curated list, not a window (the warm/cool asymmetry in what reads "pastel"
  defeats every L/C box). `generate_hue_studies.families_for(ink)` is the one
  implementation — respects the overrides and the curated list.

---

## Phase 2 — visual browse

- **Family / tone views are one flat wall of swatches**, no per-cluster boxes.
  Sorted **lightness (light → dark), then chroma (muted → vivid)**. Hue angle is
  a machine coordinate — a set of same-family swatches ordered by it reads as
  scrambled; a value ramp reads as ordered and lets an outlier pop. (Went
  through ~8 layout iterations to land here — boxes, tinted groups, and
  per-chip markers all lost to the plain wall.)
- **Every swatch links to that ink's detail view.** This is the primary
  navigation; same tab.
- **The brand on a tile links to that brand's view** — *except* when you're
  already on that brand's page, where it's plain text (no self-link).
- **The colour family on a tile/row links to the family view.** Show every
  family the ink lands on, not just one.
- **No methodology or explainer prose in the rendered UI.** Labels and data
  only. No subtitle describing the sort, no legend explaining a mark, no
  threshold recitals. If a cue needs a caption, the cue is wrong. (The
  rationale lives in code/docs, not on the page.)
- **Empty sections are omitted entirely** — never a "nothing here" caption.
- **Give-away / trial status is a flag on the ink** (a tag, and a marker
  wherever the ink appears in a list).
- Theme-aware light/dark. Swatches carry an inset hairline border so
  near-white and near-black inks still have an edge.

### Brand view specifically

- A range strip at the top (every ink in the brand, hue/lightness order) whose
  swatches **jump in-page** to that ink's detail row lower down — this stays an
  in-page anchor, it does *not* route out to ink pages.
- Below: the same inks ranked by uniqueness, each with its near-dupe
  cluster-mates. *Those* swatches link out to ink detail pages; a mate from
  another brand links its brand name to that brand's view.

---

## Phase 3 — ink show page

- **Hero: a full-bleed colour block in the ink's photographed hex**, with the
  swatch photo framed on it. Overlaid text (name, brand, hex) auto-contrasts
  black/white against the hero colour (WCAG relative luminance).
- **Info block** — only fields that have data:
  photographed hex vs. catalog (FPC) hex, each with a dot; LCh; family
  link(s); type; maker; tags; status (swabbed / inked + use count); last
  inked; date added; swatch-card motif; photo date.
- **"Reads like"** — the tight pairwise list above. Each swatch links to that
  ink's page (opens a new tab here, since you're comparing). Omitted if empty.
- **Brand name links to the brand view.**
- **"On the give-away list"** tag in the hero when the ink is on the trial
  shortlist.

---

## Navigation model (cross-cutting)

The **ink detail view is the hub.** Any ink tile, anywhere in the app, links to
it. From a browse page it's same-tab (you're navigating); from another ink's
"Reads like" it's a new tab (you're comparing).

**Exception — the collection table view** (`collected_inks.html`): the swatch and
name open the detail view as a **popup**, not a navigation (it's an `<iframe>` of
the same detail page, so it can't drift). Ken wants the peek-without-leaving
there. The Brand and Family cells still link out (brand view / family view).
The collection view's Family column uses the same `families_for()` taxonomy as
everything else — an ink can carry two family badges, both linked; the family
filter matches on either.

## Slug / URL scheme

`ink_lib.slugify(text)` — lowercase, apostrophes dropped, every other
non-alphanumeric run collapses to a single hyphen, trimmed.
- ink page: `slugify("<brand> <name>")`
- brand page: `slugify("<brand>")`
- family page: `slugify("<family name>")` (`"Golds & Ambers"` → `golds-ambers`)

One `slugify`, so a link and its target's filename can't disagree.
