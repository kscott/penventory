# Pen color is extracted and stored as a palette, not evaluated point-in-time

**Status:** Accepted — supersedes the pen-photo reasoning in PRD.md §6.5/§6.7 and
phase3-plan.md step 6/phase5-plan.md step 3 as originally written.

**Context:**
The original design made pen photos attach-only, with color evaluated fresh from the photo at
the moment of an aesthetic-pairing request (Phase 5) — nothing precomputed or stored per pen.
The reasoning: FPC's `Color` field is a resin/material *name*, not a color value, and custom
artisan resins are often swirled/multi-tone, so there was judged to be no clean single value
worth precomputing.

That reasoning holds for a single averaged color. It doesn't hold once the target is a palette —
a swirled acrylic has multiple real, extractable dominant colors; a palette is exactly the shape
that case needs. Ken wants pen colors identified and stored, so pen↔ink matching can be
data-driven the same way ink color already is, rather than re-evaluated blind on every request.

**Decision:**
- Pens get two photo roles, not one:
  - **display** — the existing full-pen shot, attach-only, cosmetic record only, never used for
    extraction.
  - **material** — a tight macro closeup of bare barrel material only (no cap, no trim, no
    background clutter), shot under the same fixed-exposure lightbox discipline already used for
    ink swatches (ISO 50, 1/500s, lightbox undimmed). Full-auto exposure has already produced a
    visibly unusable capture in practice — blown specular highlights, no background gradient —
    confirming this needs the same manual-exposure discipline, not a new one invented for pens.
- Extraction produces a **palette** (color-quantization into a small number of dominant clusters,
  weighted by pixel share), not one averaged color, and it **shares the actual extraction
  pipeline with ink's swatch service** — same white-balance/normalization step, same color space
  the hex is derived from. This is load-bearing, not cosmetic: Phase 5's aesthetic-match scoring
  is ΔE-based between pen and ink color, and ΔE is only meaningful if both sides were captured
  and converted the same way.
- Storage is relational: a new `pen_palette` table, one row per extracted color (`pen_id`, `hex`,
  `weight`), not a JSON blob — consistent with the rest of the schema's style. Deliberately not
  named with "swatch" anywhere — that word is already ink-specific (the lightbox card swatch
  photo/color); reusing it for pens would blur two distinct concepts. "Palette" is the term used
  throughout this decision.
- Phase 5's aesthetic-match service reads `pen_palette` directly. No live photo re-evaluation per
  request.

**Consequences:**
- `pen_palette` is added by a real migration when Phase 3 is actually implemented — not
  speculatively now. No `schema.ts` change lands with this ADR.
- Phase 3 step 6 (pen photo) grows real scope: two photo roles, a palette-extraction service, and
  a fixture-image-based test gate, instead of "attach-only, thinner slice."
- Phase 5 step 3's aesthetic-match bullet changes from "evaluated fresh at request time" to
  "reads the stored palette."
- Cluster-count strategy (fixed N vs. a pixel-share floor that keeps however many colors are
  actually present) is deliberately left open — a real design question for whoever implements
  Phase 3's extraction service, not decided here.
