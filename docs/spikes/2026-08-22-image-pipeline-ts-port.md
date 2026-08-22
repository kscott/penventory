# Spike: sharp/TypeScript port of the ink swatch color-extraction pipeline

**Date:** 2026-08-22
**Feeds:** `phase3-plan.md` step 5 ("Ink swatch photo pipeline") — not yet started as of this
writing. This doc is reference material for when that step is picked up, not a decision record —
see `docs/adr/` for actual decisions once any of this is settled.

**Reference implementation spiked against:** `~/Notes/personal/ink-collection/swatch_extract.py`
and `batch_swatches.py` (Ken's personal ink-collection repo, not part of Penventory) — the
prototype `project-plan.md` already points to for this feature.

## Questions this spike answered

1. Does `sharp` (the image-processing library `project-plan.md` already commits to) decode HEIC
   inside the actual `node:22-slim` runtime container?
2. Does the core color-extraction algorithm (white-balance → detect ink region → brighten card to
   white → re-detect → median color) port cleanly from Python/numpy to TypeScript/sharp, and does
   it produce matching results?

Both run against Apple's `container` CLI (this project's chosen local runtime — see
`docs/adr/2026-07-08-local-container-runtime-apple-container.md`), building the project's real
`Dockerfile` base image, not a Docker Desktop stand-in.

## Finding 1: sharp cannot decode real iPhone HEIC pixels in this container

`sharp`'s prebuilt binary in `node:22-slim` (`libvips 8.17.3`, `heif 1.20.2`) reads HEIC
**metadata** fine — correct dimensions, EXIF, XMP, even identifies the source device — but pixel
decode fails outright:

```
heif: Error while loading plugin: Support for this compression format has not been built in (11.6003)
```

Root cause: iPhone HEIC uses HEVC (H.265) compression, which is patent-encumbered. The bundled
`libheif` ships without an HEVC decoder plugin — likely a licensing decision in the prebuilt
binary, not a bug. AV1 (`aom`) decode *is* present (patent-free), so an AVIF-based capture path
would work; a standard iPhone HEIC photo does not.

**This is not actually a blocker for the real workflow.** Photos.app's default drag-out/export
behavior (its "Automatic" compatibility setting) already converts HEIC → JPEG on the way out —
confirmed by checking: every swatch photo in the personal ink-collection pipeline has landed as
`.jpeg`, despite being shot on HEIC-capturing iPhones, because nobody has gone out of their way to
use File → Export → Export Unmodified Original(s). So the practical file hitting an upload route
will already be JPEG unless a user deliberately exports raw originals.

**If Penventory ever wants to accept raw HEIC directly** (e.g. a mobile-upload flow that doesn't
go through Photos.app's export step first), two options, neither spiked further here:
- Convert HEIC → JPEG client-side or at the upload boundary before it reaches `sharp`.
- Build/vendor a `libvips`/`libheif` with a real HEVC decoder — nontrivial given the licensing
  situation; not a standard prebuilt, would need real investigation before committing to it.

Recommendation if/when this becomes a real requirement: validate the actual upload path's file
format before assuming JPEG-only is sufficient — this spike didn't test what a phone camera app
or a PWA `<input type=file>` capture actually hands the server.

## Finding 2: the ported algorithm matches Python closely — when bbox detection succeeds

Ported `white_balance`, `find_ink_bbox` (+ `_largest_contiguous_run`), `brighten_card_to_white`,
and `extract_color` from `swatch_extract.py` to TypeScript, using `sharp(...).raw().toBuffer()`
for pixel access instead of numpy arrays. Structure ported near line-for-line — no numpy-specific
behavior in the original beyond ordinary array math.

Tested against three images spanning the algorithm's known difficulty range, comparing TS output
to Python's own output on the identical image/parameters (ΔE = perceptual Lab distance, same
metric/tiers `nearest_matches.py`/`batch_swatches.py` already use elsewhere: excellent <5, good
<10, fair <15):

| Case | Python | TS | ΔE | Notes |
|---|---|---|---|---|
| Washed Lavender (pastel, clean bbox) | `#9C80BD` | `#A280C2` | 3.5 | near-identical |
| Leonardo Black at min_saturation=6 (bbox detection works) | `#48423F` | `#48413E` | **0.6** | essentially a perfect match |
| De Atramentis Dark Red (full bbox, soft/thin fringe) | `#D1696A` | `#E16367` | 9.3 | close but not exact |
| Leonardo Black at default min_saturation=15 | `#BCAEA8` (wrong) | `#8A7C78` (wrong) | 19.0 | **both fail**, differently — see Finding 3 |

**Conclusion:** when bbox detection lands on the real ink region, the ported math matches Python
to within noise (ΔE 0.6–3.5). The Dark Red gap (ΔE 9.3) sits at a bbox edge case — a bounding box
right at the density threshold, where small float-rounding/summation-order differences between
the two languages nudge the boundary by a few pixels each direction. Suspected contributors, not
yet isolated:
- `to_hex()` truncates (`int()`) in Python; the TS port rounds. Should match Python's truncation
  if exact parity is a goal.
- Summation order across ~1.5M+ pixel additions can drift slightly between numpy's reduction and
  a plain JS loop — not verified which order Python actually uses internally.

**Before treating this port as production-accurate**, that residual gap needs closing (or an
explicit decision that ΔE ~5-10 is an acceptable rewrite tolerance). The algorithm *structure* is
validated; pixel-exact parity is not, yet.

## Finding 3: the near-black bbox-detection weakness is algorithmic, not a porting artifact

At default `min_saturation=15`, **both** implementations fail on Leonardo Officina Italiana Black
— a near-neutral dark ink where most ink pixels don't clear the saturation floor. Python and TS
fail *differently* (different wrong bboxes, different wrong colors) but both fail, confirming this
is a real weakness in the algorithm's default threshold, independent of language.

This exact problem — and a first attempt at fixing it — got worked through in the Python reference
implementation in this same session (`~/Notes/personal/ink-collection` commit `30d4176`,
2026-08-22). Two bugs, both now fixed there:

1. `find_ink_bbox()` could return a "successful" (non-`None`) but tiny/wrong bbox instead of
   failing outright — added a plausibility floor (bbox must span ≥10% of each frame dimension).
2. The retry-on-failure loop was stopping at the *first* saturation threshold that merely cleared
   that floor, not the one that found the actual full ink region — a lower threshold can find a
   plausible-sized-but-still-wrong region. Fixed by trying every fallback threshold and keeping
   whichever finds the most ink pixels (same "prefer the larger candidate" logic
   `_largest_contiguous_run()` already uses elsewhere in that file).

**Action for Phase 3 step 5:** design this in from the start rather than re-discovering it. The TS
port needs the same two properties: (a) a bbox-size sanity check, not just a null check, and (b)
when a fallback/retry ladder exists, evaluate all rungs and keep the best result by ink-pixel
count — never trust the first one that merely doesn't error.

## Finding 4: no vision/OCR step belongs in this pipeline

`swatch_extract.py`'s `process()` takes ink name and card motif as **explicit parameters**
(`ink_name`, `card_motif`) — it does no image recognition itself. The "Claude reads the
handwritten ink name off the photo" step lives one layer up, in the `swatch-processing` skill's
manual workflow, not in the extraction function.

So the Phase 3 upload flow doesn't need any vision-model dependency to match this contract — it
just needs the same explicit-input shape: whoever uploads a swatch photo supplies the ink identity
(a picker tied to the Ink CRUD from step 1) and card motif (free text or a small controlled list,
mirroring the ~10 known Colorverse card designs) directly through the UI, the same way the CLI
takes `--name`/`--card-motif` today.

## Finding 5: the display-crop/label-detection logic has the same class of bug, found the same day

Not part of this spike's ported code (the TS port only covers color extraction — see "Not yet
spiked" below), but surfaced independently while reviewing a reprocessed swatch and worth
recording here because it's the same underlying failure pattern as Finding 3, just in a different
function: an algorithm that "succeeds" with a plausible-looking but wrong answer instead of failing
loudly, discovered by a human noticing the output looked off rather than by an error.

`swatch_extract.py`'s `_label_start_row()` (used only to frame the *saved display crop* — it has
no effect on the extracted color) finds where the handwritten ink-name label starts by scanning for
a run of rows with sparse dark marks on an otherwise-bright background, then "walks back" from that
point with a looser threshold to catch a letter's ascender tip before the main run. Found on
Birmingham Pen Company Washed Lavender (`~/Notes/personal/ink-collection` commit `dcfe169`,
2026-08-22): on this card, the wash's own fading fringe blends into the label's leading edge as one
smooth, continuous density ramp with no row anywhere dropping below the loose walkback threshold —
so the walkback (default cap: 400 rows) followed that ramp 64 rows back past the fringe into the
wash itself, and the saved crop clipped ink that was still clearly visible in the photo. Fixed by
capping the walkback distance to 10px — accepts that a barely-visible sliver of a letter's ascender
tip may occasionally survive into the crop, rather than risk clipping real ink again.

**Action for Phase 3 step 5:** if/when the TS port grows a display-crop feature (framing the
uploaded photo down to just the swatch, keeping the handwritten label out of frame), the same
principle applies as Finding 3: a "found a plausible-looking boundary" heuristic that walks/searches
across a gradient needs a tight, deliberately-justified stopping distance, not a generously large
one picked to be "safe" — a large search radius doesn't fail loudly when it walks too far, it just
quietly produces a worse-but-plausible answer. Test against cards where the wash and label sit close
together, not just the common case with a big blank buffer between them.

## Not yet spiked / open for Phase 3

- The hue/LCh clustering math that drives Ken's separate study pages (`hue_range_study.py`,
  `hue_cluster_study.py`) — untested here. `culori` looks like the right TS equivalent (Lab/LCh/ΔE
  built in) but wasn't exercised in this spike, which only covered the swatch-extraction side.
- The display-crop/label-detection logic (`_swatch_body_x0`, `_label_start_row`,
  `_true_bottom_edge`, `save_annotated`) wasn't ported or spiked at all here — only the color-math
  functions were. See Finding 5 for a bug already found in the Python original that whatever ports
  this next needs to account for.
- Whether the manual "top-third crop instead of full bbox" override Ken used by hand on three
  De Atramentis inks (2026-08-22, same session) should become a first-class UI affordance
  (adjustable sample region) in Penventory, rather than a one-off script re-run.
- Exact pixel-parity fix for the `to_hex` rounding/summation-order gap (Finding 2).
- What file format actually arrives at a real upload endpoint (phone camera, PWA capture) — this
  spike only tested pre-existing JPEG/HEIC files copied in by hand, not a real upload path.
