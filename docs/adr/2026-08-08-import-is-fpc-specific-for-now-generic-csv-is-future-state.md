# Import is FPC-format-specific for now; generic CSV import is a future state

**Status:** Accepted

**Context:**
Phase 1.1's import feature was built against FPC's own export shapes without ever stating that as
a deliberate, bounded scope choice — code and docs read as if "import" meant "parse an FPC CSV,"
full stop. Surfaced 2026-08-08 during live review of the import UI: the route was about to gain
header-sniffing logic (detect "Model"/"Filling System" columns → pens, "Name"/"Type" → inks) that
quietly baked FPC's specific column names in as if that were a generic capability. Ken caught it.
FPC alone already exports three distinct file shapes, not one — `collected_pens.csv`,
`collected_inks.csv`, and `currently_inked.csv` (usage/inkings, deferred to Phase 4,
`project-plan.md`'s Phase 1.1 section) — so "FPC format" was never monolithic to begin with.

Ken confirmed a generic CSV importer — accept an arbitrary file, let the user map its columns onto
Penventory's required/optional fields — is real, wanted, eventual product direction, not
hypothetical scope creep. Building it now would be premature: FPC is the only real data source
today, and a field-mapping UI is a substantial feature with no second format yet to design
against, or generalize a mapping UI from.

**Decision:**
Start with the known FPC shapes (pens, inks, and eventually usage) as the current, expedient
implementation — not because generic import isn't wanted, but because there's nothing yet to
generalize from. Content type is indicated explicitly at upload time — pens, inks, or usages,
chosen by the person uploading — rather than inferred by sniffing the file's header. Explicit
indication isn't just simpler than detection; it's also the interaction a generic importer will
need regardless (it still has to be told "this is a pens-equivalent file" before it can offer
field-mapping against the pens schema), so building it this way now doesn't need revisiting later.

Generic CSV import (arbitrary columns, user-driven field mapping onto Penventory's schema) is the
target end state. Not scheduled to any phase — revisit once a second real data source exists to
design against.

**Consequences:**
- The upload UI always asks for content type explicitly (pens/inks/usages), never sniffs the file
  to guess. Cheaper to build now, and the right interaction shape even after generic import lands.
- `project-plan.md` and `phase1.1-plan.md`'s import language means "the FPC importer," not "import"
  unqualified — this ADR is the pointer whenever that distinction matters.
- No field-mapping UI, no format-abstraction layer, no pluggable-parser architecture gets built
  now. There's exactly one real source; designing for a hypothetical second one would mean guessing
  at a shape nothing has confirmed yet.
- When a second real source shows up (or FPC's usage export gets built out in Phase 4), this
  decision reopens from scratch, informed by that source's actual shape — nothing here is built
  "generic-import-ready."
