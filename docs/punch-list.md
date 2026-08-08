# Punch List

Small, one-off "don't forget this" notes — not the project's real backlog. GitHub issues are
the source of truth for actual work to be done. Something that grows into real scope becomes an
issue and gets removed from here, not left in both places.

- **Wishlist color/image field.** `wishlist_items` has no field for the candidate ink's swatch
  image or extracted color, even though vision.md's before-you-buy workflow mentions a "color
  check" as part of what carries forward on conversion. Not a gap worth fixing now — the
  before-you-buy workflow itself is explicitly deprioritized to "someday" (vision.md), and this
  is a detail of a feature that isn't being built yet. Revisit if/when that workflow gets built.

- **Loose/spare nib inventory + reassign-existing-nib UI.** Confirmed 2026-07-10 (Ken): he owns
  standalone Esterbrook nibs not currently installed in any pen, in the same common sizes several
  of his pens already use. The schema already supports this (a `nibs` row with no `pen_nibs` entry
  pointing at it is a valid, well-formed spare) — no schema change needed. What doesn't exist yet:
  any UI/import path to (a) enter a standalone spare nib, or (b) choose an existing loose nib to
  install into a pen instead of always creating a fresh `nibs` row. Nibs are never deduplicated by
  spec (two pens with an identical bare "M" nib are still two different physical objects), so this
  is a deliberate user choice ("assign this specific loose nib"), never automatic matching. Belongs
  to Phase 3/4's manual nib management.

  **Added 2026-08-08:** a new angle on the same need — Ken wants a more efficient way to enter a
  whole batch of loose nibs at once, not just one at a time. Genuinely open, not scoped: could be
  CSV-file-shaped (in which case it'd join the FPC import content-type list alongside pens/inks/
  inkings — see `docs/adr/2026-08-08-import-is-fpc-specific-for-now-generic-csv-is-future-state.md`)
  or a dedicated bulk-entry form with no file involved. Whichever it turns out to be, revisit
  alongside the rest of this item when Phase 3/4's manual nib management gets built.
