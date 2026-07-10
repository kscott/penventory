# Penventory — Phase 6 Plan: Polish and the still-open questions

Three questions the vision doc left genuinely unresolved, plus export. Each gets an
explicit **decide-then-build** step here — none of them get a silent default.

## Ordered steps

1. **Nib storage/location tracking.** Design pass first: propose `storage_location`
   on `nibs` (free text, or a small controlled list of boxes/slots if that proves
   useful in practice) — confirm the shape with Ken before migrating. Then a normal
   CRUD slice once confirmed. Motivated by the six-months-success criterion: loose
   nibs currently live in snap boxes with a film holder each, and finding a specific
   one means digging.
   *Gate:* design confirmed (no test — a decision); then full DoD tiers for the build.

2. **Corrected/canonical hex.** Decide build-vs-not first — this is Ken's own
   perfectionism about vendor values vs. a real feature, and it's still undecided
   which. If built: `corrected_color` + `correction_source`
   (`colorimeter_reading` / `swatch_extracted` / `community_source`) added to `inks`;
   rescan-flagging at ΔE ≥ 20 between the FPC value and the measured value (mirrors
   the existing `compare_colorimeter.py` audit pattern, surfaced as an in-app flag list
   instead of a manual script run).
   **Service-layer constraint:** a correction write must cite one of the
   already-captured measured sources — never a freeform re-typed value. That's
   exactly the failure mode this feature exists to fix (`ink_corrections.py`'s "pulled
   a value out of my ass" case) — allowing a fourth manual guess on top would defeat
   the point.
   *Gate:* if built — unit test rejects a correction write with no cited source;
   integration test for the rescan-flagging query; full DoD tiers otherwise.

3. **Bulk operations for pens/nibs.** Confirm need first — unconfirmed in the vision
   doc whether pens/nibs arrive in batches the way ink does. If yes: reuse Phase 3's
   ink bulk-edit component, parametrized by entity type, not a rebuild.
   *Gate:* if built — same Playwright regression-test pattern as Phase 3 step 7,
   applied to the new entity type.

4. **Export (CSV/full).** Lowest priority, last slice. Repo-level dump service +
   route.
   *Gate:* contract test for schema completeness (every field that should export,
   does).

## Definition of done

Each of the three open questions is either built (with tests) or explicitly declined
with reasoning recorded as its own file in `docs/adr/` — not left ambiguous.
Export exists.
