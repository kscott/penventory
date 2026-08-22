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
go through Photos.app's export step first), two options:
- Convert HEIC → JPEG client-side or at the upload boundary before it reaches `sharp`.
- Build `libvips` against a real HEVC decoder and point `sharp` at it. Not spiked (no build
  attempted, no container run to confirm it actually decodes) — but the path is documented below
  since it's a real, available option, not just a "maybe possible" note.

Recommendation if/when this becomes a real requirement: validate the actual upload path's file
format before assuming JPEG-only is sufficient — this spike didn't test what a phone camera app
or a PWA `<input type=file>` capture actually hands the server.

### Building libvips with real HEIC decode — the option, not (yet) exercised

The gap is a **deliberate patent-licensing exclusion from sharp's prebuilt binary**, confirmed
against sharp's own GitHub issues and the libvips maintainers, not a technical limitation: HEVC/
H.265 is patent-encumbered, and a globally-distributed npm binary avoids shipping a decoder for it.
Same reason AWS won't offer HEIC support in a shared Lambda layer. It doesn't mean the decoder
doesn't exist or can't be built — it means nobody wants to be the one distributing it pre-built to
anonymous npm installs.

For Penventory specifically, two things make this simpler than the general case:

- **Decode-only, no encode needed** — the app only ever *reads* an uploaded HEIC photo, never
  writes one. That means `libde265` (the HEVC decoder, LGPL) + `libheif` (the HEIF container
  format, LGPL), no `x265` (the HEVC *encoder*, GPL) at all. Simpler dependency graph, and clear of
  GPL entirely for what's actually needed.
- **Deployment target is always Linux in a container** — the `sharp` docs' one real limitation
  ("use of a globally-installed libvips is unsupported on Windows and on macOS when running Node.js
  under Rosetta") doesn't apply; this is a non-issue for a `node:22-slim` Docker build, dev-container
  parity included.
- **Not a distribution/patent-pool concern for a single-user, non-distributed app** — the HEVC
  patent pools' commercial terms are built around manufacturers/distributors of products at scale,
  not an individual compiling and running an open-source decoder for personal use. Not a legal
  opinion, just the practical shape of it — the same category of thing as running Plex/Jellyfin
  with HEVC transcoding at home, which is common and unremarked-on.

**Two build paths, not yet tried against each other:**

1. **Try apt first — may already be enough.** Debian bookworm's *main* repo (not just backports)
   already carries `libde265-dev` (1.0.11-1+deb12u2) and `libvips-dev` depends on `libheif-dev`
   directly:
   ```dockerfile
   RUN apt-get update && apt-get install -y --no-install-recommends \
       libheif-dev libde265-dev libvips-dev pkg-config \
       && rm -rf /var/lib/apt/lists/*
   ```
   Whether Debian's own `libheif-dev` build has HEVC decode actually compiled in (vs. built as an
   optional plugin, per `libheif-plugin-libde265` existing separately in bookworm-*backports* for a
   newer libheif) is the open question — check with `heif-convert --list-decoders` inside the
   container before assuming this alone is sufficient.

2. **Build from source if apt's build doesn't have it compiled in** — guaranteed to work, more
   image bloat/build time:
   ```dockerfile
   RUN apt-get update && apt-get install -y --no-install-recommends \
       build-essential cmake pkg-config git ca-certificates \
       && rm -rf /var/lib/apt/lists/*
   RUN git clone --depth 1 https://github.com/strukturag/libde265.git /tmp/libde265 \
       && cmake -S /tmp/libde265 -B /tmp/libde265/build && cmake --build /tmp/libde265/build -j \
       && cmake --install /tmp/libde265/build
   RUN git clone --depth 1 https://github.com/strukturag/libheif.git /tmp/libheif \
       && cmake -S /tmp/libheif -B /tmp/libheif/build -DWITH_X265=OFF \
       && cmake --build /tmp/libheif/build -j && cmake --install /tmp/libheif/build
   # then build libvips itself from source, linked against this libheif —
   # see https://github.com/libvips/libvips for its own build instructions
   ```

**Getting `sharp` to actually use it, either path:**
```dockerfile
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
RUN ldconfig && npm install sharp
```
`pkg-config --modversion vips-cpp` must resolve for this to work — confirm it does before the
`npm install` step. `SHARP_IGNORE_GLOBAL_LIBVIPS` is the opposite flag (forces the bundled prebuilt,
skips detection entirely) — don't set that one.

None of this has been run — no container built, no `heif-convert`/`sharp` decode test against a
real HEIC file with either path. Before committing to this for Phase 3 step 5, actually build it
and confirm decode works, the same way Finding 1's failure was confirmed rather than assumed.

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
