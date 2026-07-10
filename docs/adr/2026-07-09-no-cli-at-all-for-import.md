# Escalated: no CLI at all, not even for local testing

**Status:** Accepted — current design (supersedes
[[2026-07-08-fpc-import-ken-triggered-cli]])

**Context:**
[[2026-07-09-import-gets-own-phase-1-1]] still allowed a CLI as a local dev/test tool; Ken
rejected that too, in two steps. First, a proposal to make CLI review interactive (prompts in the
terminal, writing decisions straight to the database instead of a hand-edited file) — rejected
outright: reviewing/deciding on flagged items is real work on real data, and that only ever
happens through the app's own UI, full stop, not a terminal, not a script, not a scriptable flag.
Second, confirmed there's no CLI *entry point* in this feature at all, in either direction: "It's
a process run through the browser. You use the browser to upload the file, it's run through
import, database records created, then the UI for resolving problems and approving the import is
given and interacted with."

**Decision:**
- No `npm run import:fpc` script, no argv parsing, ever. Phase 1's tests call the service
  functions (`lib/server/services`) directly against a temp-file SQLite — the same pattern
  `resolveOrFlag` and the repository layer already use.
- Phase 1 doesn't need the real `db` client module after all — it was only justified as "the CLI
  needs a real local database to run against." With no CLI, nothing in Phase 1 ever touches a
  non-temp-file database. The client module moves to Phase 1.1 step 1, alongside auth — the
  first point a genuinely persistent, long-running connection is actually needed.
- Persisted state is `import_attempts` + `import_flagged_items`, confirmed as "the right storage"
  by Ken directly (superseding the earlier `import-report.json` file idea entirely — no file, at
  any point, in any phase): `import_attempts(id, operation_type, status[open/committed],
  created_at, committed_at)`; `import_flagged_items(id, import_attempt_id → import_attempts,
  row_data json — a snapshot so a decision survives even if the source CSV changes, flag_type,
  candidate_info json nullable, decision nullable, decision_target_id nullable, decided_at
  nullable)`. Parsing creates the attempt + flagged rows with `decision = null`; Phase 1.1's UI is
  the only thing that ever sets `decision`; commit reads by attempt id and refuses if anything is
  still null.
- Fixture CSVs are many small, targeted files, not one monolithic one — Ken's explicit
  preference, confirmed against the concrete breakdown proposed (`tests/fixtures/fpc-export/
  {pens,inks}/`, one file per condition: exact-duplicate, near-duplicate-typo, brand-drift,
  known-alias, the `Nib`-column cases, finish-as-plating-color). A failing test should point at
  exactly which condition broke, not require cross-referencing rows in a large file. Confirmed as
  a starting list, expected to grow, not a final enumeration.

**Consequences:**
- Phase 1's own tests exercise the commit path by writing a decision directly into a
  flagged-item row (standing in for what the UI will do), then asserting — ordinary integration
  testing, no human needed, since fixture outcomes are already known.
- Net effect on `phase1-plan.md` step 6: builds parsing/`resolveOrFlag`/dedup/persistence/commit
  as pure service code, tested directly — no CLI, no db client module, both removed from this
  step entirely rather than just relabeled. Step 7 ("Ken's real run") is now just a boundary
  statement: there is no path to real data in Phase 1 at all, by design, not a gap to apologize
  for.
