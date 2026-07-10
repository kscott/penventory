# Import earns its own phase: Phase 1.1, inserted between Phase 1 and Phase 2, no renumbering

**Status:** Accepted (its "local CLI test harness" detail superseded same-day by
[[2026-07-09-no-cli-at-all-for-import]])

**Context:**
Direct consequence of [[2026-07-09-no-shell-ssh-operational-rule]]: the FPC import isn't actually
*done* in any usable sense until it's a real, authenticated web feature — not a CLI, not even
temporarily. That feature needs auth (previously slated as "Phase 2 step 1") and needs to exist
before Phase 2's Visual Browse phase, since Browse was already written to assume real pen/ink
data exists by then.

**Decision:**
Rather than renumbering `phase2-plan.md` through `phase6-plan.md` (pure-churn cascade — file
renames plus fixing every cross-reference for no information gain — see
[[feedback_no_numbered_filenames]]), the new phase is named **1.1** and gets its own
`docs/phase1.1-plan.md`, sitting between the two without shifting anything else. Phase 1 itself
is rescoped: it builds the parsing/`resolveOrFlag`/dedup **service logic**
(`lib/server/services`) and, at the time of this entry, was to prove it out via a local CLI test
harness. Phase 1.1 wraps that same service logic in authenticated routes + a review/decide UI,
and does the same for the color-refresh operation.

**Consequences:**
- Until Phase 1.1 ships, the honest state is "the app doesn't yet support importing real data" —
  not a CLI-based workaround dressed up as good enough.
- The "local CLI test harness" detail was itself dropped the same day — see
  [[2026-07-09-no-cli-at-all-for-import]] — but the phase split itself stands unchanged.
