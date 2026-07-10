# FPC import identity is fuzzy, not ID-based

**Status:** Accepted

**Context:**
Checked Ken's actual `collected_inks.csv`/`collected_pens.csv` (260/282 rows): no per-record ID
exists in either.

**Decision:**
Natural keys are composite — Brand+Line+Name+Type for inks, Brand+Model+Nib+Color+Material+Trim
for pens — so duplicate detection has to be similarity-scored, not exact-match. "Mistakes
happen, data isn't always clean" (Ken).

**Consequences:**
- Ken's existing prototype (`import_inks.py`) sidesteps this by dropping and recreating its
  table every run; that doesn't transfer here, since real ledger/tag/purchase data attaches to
  catalog rows that a wipe-and-reload would orphan.
- The same fuzzy-matching problem recurs harder in Phase 4: `currently_inked.csv` cross-references
  pens/inks by a reconstructed description string, not an ID — deferred there since it needs the
  catalog and `inkings` table both to exist first. See `phase1-plan.md` step 6 and
  `phase4-plan.md` step 5.
