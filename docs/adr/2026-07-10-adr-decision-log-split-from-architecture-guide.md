# ADR decision log split out of ARCHITECTURE.md into its own folder

**Status:** Accepted

**Context:**
`ARCHITECTURE.md` was named as if it documented how the app is built, but everything in it was a
dated decision record — closer to a work ADR than a guide. Ken: "the file ARCHITECTURE.md, by
name, should tell me how the app is constructed, and is the guide for how to build things. What
is going in there is a decision record — not guidance."

**Decision:**
Split into two things. `docs/adr/` holds one file per decision, named `YYYY-MM-DD-slug.md` — a
date-based slug, not a sequence number, since new decisions land at the current point in time and
never force a renumbering cascade (same reasoning as
[[feedback_no_numbered_filenames]], confirmed as fine here specifically because nothing about
this convention ever requires reordering existing files). Each ADR uses a structured template
(Status/Context/Decision/Consequences). `ARCHITECTURE.md` becomes the living guide to how the app
is actually built today — current structure, patterns, and conventions — with no dated entries of
its own.

**Consequences:**
- `project-plan.md` will eventually be archived once it's fully superseded by the built app —
  `ARCHITECTURE.md` is what lives on and stays current, not `project-plan.md`.
- All ~40 existing decisions migrated into individual `docs/adr/` files, preserving
  Superseded/Amended relationships between them (e.g. the FPC-import CLI design went through
  three revisions before landing on no-CLI-at-all — each kept as its own file rather than edited
  in place).
- CLAUDE.md, README.md, and every phase-plan doc that referenced "`ARCHITECTURE.md`'s 2026-07-09
  entry" updated to point at the specific ADR file instead.
