# Punch List

Small, one-off "don't forget this" notes — not the project's real backlog. GitHub issues are
the source of truth for actual work to be done. Something that grows into real scope becomes an
issue and gets removed from here, not left in both places.

- **Wishlist color/image field.** `wishlist_items` has no field for the candidate ink's swatch
  image or extracted color, even though vision.md's before-you-buy workflow mentions a "color
  check" as part of what carries forward on conversion. Not a gap worth fixing now — the
  before-you-buy workflow itself is explicitly deprioritized to "someday" (vision.md), and this
  is a detail of a feature that isn't being built yet. Revisit if/when that workflow gets built.

- **`sqlite.pragma('foreign_keys = ON')` is currently test-only.** No production DB connection
  code exists yet anywhere in `src/lib/server` (every service takes a `db`/`sqlite` handle as a
  parameter — nothing calls `new Database(...)` outside tests), so there's nowhere in the real app
  to set this pragma yet. Found while auditing import-time safety: a `merge_into`/`decision_target_id`
  pointing at a row that doesn't exist relies entirely on FK enforcement to fail loudly rather than
  writing an orphaned reference — that only holds if whatever wires up the real production
  connection (Phase 1.1 or later) remembers to set this pragma. Revisit when that connection-setup
  code gets written.
