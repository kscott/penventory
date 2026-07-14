# A re-flag from commit-time correction updates the original row, not a new one

**Status:** Accepted

**Context:**
Three commit-time paths can discover that a row is still ambiguous after doing more work than
parse time could: correcting an `unparseable_row`, correcting an `unparseable_nib`, and resolving
a deferred model/line once its brand's id is finally known (brand was itself flagged or new at
parse — see `docs/adr/2026-07-10-unparseable-rows-are-correctable.md` and the per-field-decisions
ADR). All three previously handled "still ambiguous" the same way: push a `PendingFlag`, and once
the whole transaction rolls back (it always does — `runCommitTransaction` throws whenever
`newFlags.length > 0`), the `catch` block in `commitImportAttempt` **inserted a brand-new**
`import_flagged_items` row for it, using the outer non-transactional `db` handle (since anything
written inside the rolled-back transaction is gone).

This looked reasonable in isolation but broke retrying commit, confirmed with a real scenario: a
brand gets decided via `merge_into` on a row (`field_decisions.brand` set), commit discovers the
now-brand-scoped model is *also* ambiguous, refuses, and a new row gets inserted for the model
ambiguity. The **original** row is untouched — its `flag_type` is still whatever it was
originally (e.g. `needs_confirmation` for the brand), its row-level `decision` is whatever it was
(often `null`, since brand was decided via `field_decisions` not a row-level decision), and its
`row_data` still has `model: null` (never resolved, since it was deferred at parse). On a second
`commitImportAttempt` call:
- The original row is still "fully decided" (its own field_decisions/decision haven't changed),
  so `isItemFullyDecided` lets it through into the transaction again.
- Inside the transaction, model resolution runs from scratch again (`rowData.model` is still
  `null`) — finds the *exact same* ambiguity again, and pushes *another* new row.
- The newly-inserted row from the first attempt — even after being correctly decided
  (`decideField(newItem.id, 'model', 'merge_into', ...)`) — is irrelevant: nothing in the retry
  ever looks at it, because the original row never learned to consult it.
- The whole transaction rolls back again (the *original* row's re-push causes it, independent of
  whatever the previously-inserted row would have done), and a *third* row gets inserted.

This repeats forever. Confirmed by tracing the exact sequence rather than assuming: the previously
existing test for this case ("flags a new model/line ambiguity... and refuses to commit") only
ever called `commitImportAttempt` once and asserted the refusal — it never attempted a second call
to see whether the resulting flag could actually be resolved. It couldn't. Once a deferred
model/line ambiguity (or a still-ambiguous correction) was discovered, the import attempt was
**permanently stuck** — no sequence of decisions could ever get it to commit.

**Decision:**
A re-flag from any of these three paths now **updates the original row in place** (`PendingFlag`
gained `originalItemId: number`, threaded through every push site). The `catch` block in
`commitImportAttempt` does `db.update(import_flagged_items).set(...).where(eq(id, originalItemId))`
instead of `db.insert(...)`:
- `row_data`, `flag_type`, `candidate_info` are replaced with the new pending values.
- `decision`, `decision_target_id`, `decided_at` reset to `null` — the row now represents a
  genuinely new question and needs its own fresh, explicit answer (critically: if the row had
  become `possible_duplicate`, a stale leftover `decision: 'import'` from its *previous* identity
  must not silently count as already having confirmed *this* duplicate).
- `field_decisions` is **preserved**, not cleared — a `merge_into` already recorded for `brand` on
  this row must still apply once `model` is what's newly ambiguous; per-field decisions are keyed
  by field name and only ever consulted for the field they name, so old entries for
  already-resolved fields are inert once no longer referenced, never wrong.

The deferred model/line resolution branches (previously raw `resolveOrFlag` + `settleField`
inline in `runCommitTransaction`) were also rewritten as a shared `resolveDeferredField` helper
that checks `item.field_decisions[field]` first (routing through `applyDecision` — the same
merge_into/alias_to/import/contains-guard logic every other field gets) before falling back to
fresh resolution. This is what actually makes the fix land: without it, a `field_decisions.model`
entry on the (in-place-updated) original row would still never be read, because the deferred
branch never looked at `field_decisions` at all before this change — it only ever called
`resolveOrFlag` fresh and either resolved automatically or re-flagged, with no way to inject a
`merge_into` decision.

Also folded in while touching this: `resolveRowForCommit`'s `unparseable_row` correction path
now re-runs duplicate detection (`findDuplicateMatches` against `loadExistingPenKeys(tx)`) instead
of unconditionally passing `[]`. A blank-required-field row has nothing to check for duplicates at
parse time (resolution never runs — see the correctable-rows ADR), but once corrected, its
composite key can match an existing pen exactly as easily as any fresh row's could. Before this
fix, a corrected `unparseable_row` could commit as a silent, fully duplicate pen — confirmed with
a test seeding an existing pen, correcting a blank-Brand row to match it exactly, and observing
`commitImportAttempt` return `{ committed: true, pensCreated: 1 }` with no flag and no error.
Checking against `tx` (not a separately-loaded snapshot) also means a match against a pen written
earlier in the *same* transaction is caught too, via ordinary read-your-own-writes — no separate
in-memory batch list needed the way parse-time duplicate detection uses one.

**Consequences:**
- Retrying a commit after any correction or deferred re-flag now actually converges: decide the
  newly-flagged field/row and commit succeeds, proven end-to-end by new tests (`fpc-import.integration.test.ts`) for both the model/line-deferred case and the unparseable_row-duplicate case.
- `import_flagged_items` row count for a given attempt only ever grows when a *genuinely new,
  independent* row is discovered (e.g. an ink-side new-line ambiguity) — never as an artifact of
  retrying the same row's resolution.
- `PendingFlag.originalItemId` is now load-bearing, not incidental — any future path that pushes a
  `PendingFlag` must supply the real originating row's id, not a fresh one.
