# Penventory — Phase 3 Plan: Core CRUD, tagging, photos, bulk ops

Full manage-the-collection layer: add/edit for all three entities, the tag filtering
the vision doc calls "job one," the existing swatch-photo pipeline brought into the
app, and the ink bulk-edit feature that directly targets FPC's worst pain point
(losing scroll position on every single-item edit).

## Ordered steps

1. **Ink CRUD** (list/show/add/edit) — full slice. Canonical Brand/Line picker with
   the "Add new..." escape hatch wired into the actual form, not just the Phase 1
   repository layer.
   *Gate:* full DoD tiers — unit (service), integration (repo writes), contract
   (routes), Playwright (form flow).

2. **Pen CRUD** — same picker pattern. `size_category` / `condition` /
   `accessories_note` fields. `ownership_state` filtering: default list view excludes
   retired/rehomed, an explicit toggle reveals them (never on by default).
   *Gate:* same tiers; Playwright specifically covers the hidden-by-default behavior.

3. **Nib CRUD** — standalone entity, no originating pen required, per the vision
   doc's "nib can be purchased entirely on its own" requirement.
   *Gate:* same tiers.

4. **Tag assignment + AND/OR filter.** Service + route + UI filter component.
   *Gate:* unit tests for AND vs. OR query logic against fixture tag sets (this is the
   feature FPC gets wrong two ways — filtering has to actually work here).

5. **Ink swatch photo pipeline.** Ports `swatch_extract.py`'s logic (auto-detect the
   swatch region in the lightbox photo, white-balance, extract a representative color,
   generate the labeled Photo/Colorimeter/FPC composite overlay) to a `sharp`-based
   service. `photos` table, upload route, UI.
   **`swatched` computed column added by migration here** — its dependency (`photos`)
   now exists (see Phase 1's "Deferred columns" note).
   *Gate:* unit tests against **checked-in fixture swatch images** (no live
   camera/external service — this is how "no live external state" holds for this
   slice); contract test for upload; Playwright for the upload flow.

6. **Pen photo.** Attach-only, no extraction — pen color is evaluated point-in-time
   later (Phase 5's aesthetic pairing), nothing precomputed or stored beyond the photo
   itself. Thinner slice.
   *Gate:* same tiers as step 5, minus the extraction-specific unit tests.

7. **Bulk operations for ink.** Multi-select + bulk field update across selected
   rows — the confirmed real need from the vision doc, arrival-in-batches being the
   common case.
   *Gate:* a Playwright test that specifically reproduces the named FPC failure mode —
   select N inks, edit one shared field, save, assert scroll position is preserved
   **and** all N rows updated. Written to fail against a naive
   re-render-from-top implementation, so it actually proves the fix rather than just
   exercising the happy path.

## Definition of done

Pens/inks/nibs are fully manageable end-to-end, including photos and tag-based
filtering. The FPC bulk-edit pain point has a regression test proving it's fixed, not
just a feature that happens to work today.
