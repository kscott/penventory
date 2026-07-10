# Docs live in the repo, not in Notes

**Status:** Accepted

**Context:**
`vision.md`, `PRD.md`, and the project plan were originally authored in
`~/Notes/personal/ink-collection/` during the planning phase, before the repo existed.

**Decision:**
`docs/vision.md`, `docs/PRD.md`, `docs/project-plan.md`, `docs/phase0-plan.md` moved into this
repo's `docs/`, versioned alongside the code.

**Consequences:**
- Project documentation lives with the code it describes.
- Raw FPC export data and the prototype color-clustering scripts (`gen_inks.py` and friends)
  stay in Notes — personal source data and standalone tooling, not project documentation, and
  not superseded by this repo existing.
