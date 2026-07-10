# Controlled-list treatment extended to five more fields

**Status:** Accepted

**Context:**
Same drift problem as brand/line/model, applied wherever a field is a proper name or open-ended
category rather than a small closed set. Concretely proven, not theoretical: Ken's own real FPC
export already has three spellings of "Cartridge/Converter" and two of "Pump Filler" in
`filling_system`, found by direct inspection.

**Decision:**
Extended `resolveOrFlag` + `aliases` (see
[[2026-07-08-duplicate-protection-shared-resolveorflag]]) to `pen_materials`,
`nib_materials`, `finishes`, `filling_systems`, `nib_shapes`, `vendors`.

**Consequences:**
- `nib_shapes` merges what would have been two separate fields (`tipping_type`, `grind_type`) —
  same underlying fact ("what shape is this tip") regardless of whether it shipped that way, was
  a factory custom order, or was ground later.
- `vendors` merges `purchases.vendor` and `nibs.nibmeister` — a nibmeister is a vendor (paid for
  a service), and keeping them separate meant one real business (Kirk Speer / PenRealm) could
  show up as two disconnected, unmatchable strings.
- `pen_materials` and `nib_materials` stay separate tables despite both being called "material" —
  different vocabularies (Acrylic/Ebonite vs. Gold/Steel/Titanium) sharing one mechanism, not one
  table.
