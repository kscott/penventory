# CSV library: `csv-parse` for reading, `csv-stringify` for writing

**Status:** Accepted

**Context:**
Two real gaps, not one — `project-plan.md` never named a CSV library at all, and CSV isn't
read-only: Phase 1 and Phase 4 read FPC exports, but Phase 6's Export writes Penventory's own
data back out, gated by a contract test for field-completeness.

**Decision:**
Verified live against the npm registry before deciding: `csv-parse` (7.0.1, 0 runtime deps,
~59.7M downloads/month, sync API confirmed alongside its stream API, delimiter fully
configurable — needed for FPC's semicolon-delimited files) and `csv-stringify` (6.8.1, 0 runtime
deps, ~29.8M downloads/month) — same project/maintainer as `csv-parse`, so read and write share
one config vocabulary for delimiter/quoting.

**Consequences:**
Rejected: `fast-csv` (bundles its own `@fast-csv/format` + `@fast-csv/parse` as real runtime
dependencies, not actually zero-dep despite being one package name) and `papaparse` (its
`unparse()` write path is genuinely first-class, but the library is fundamentally browser-first —
a design mismatch for a Node-only route use case).
