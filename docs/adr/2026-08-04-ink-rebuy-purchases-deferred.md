# A confirmed ink rebuy still creates a second `inks` row until Phase 4's `purchases` table exists

**Status:** Accepted

**Context:**
Surfaced while mocking up Phase 1.1 step 3a's possible_duplicate review UI, using the real Ohio
River case as an example (two real bottles of "Birmingham Pen Co. — Ohio River" — one gifted away
and archived 2025-04-11, one bought fresh 2025-08-07). Ken asked directly: is this a real condition
to consider — importing another bottle of an ink already entered — and how does the data model
handle it?

`docs/PRD.md` §5.4 already answers this for the *intended* long-term model: "Ink is consumable in
the same sense [as a nib grind]: a bottle runs dry and gets rebought. Each rebuy is a new purchase
entry on the *same* ink catalog record — not a new row, not an untracked fact." One `inks` row,
N `purchases` rows. `ownership_state` (see
`docs/adr/2026-08-04-ink-ownership-state-gains-empty.md`) reflects current status only; the
purchase history is what actually tells the "gifted it away, then bought another" story.

The gap: `purchases` doesn't exist until Phase 4 (`project-plan.md`'s Phase 4 scope). Phase 1.1's
review UI has nowhere correct to put a confirmed rebuy today.

**Decision:**
Accept the temporary duplication rather than pull `purchases` forward into Phase 1.1's scope. A
possible_duplicate row decided `import` (Ken confirming "yes, this is a genuine rebuy, not a data
error") creates a second `inks` row today — not the final correct shape, but not silent data loss
either.

This is safe specifically because `import_flagged_items` permanently keeps the full decision
record: `flag_type: 'possible_duplicate'`, which existing ink it matched (`candidate_info.matches`),
and that the decision was `import` rather than `skip`. Nothing here is deleted or overwritten by a
later commit. When Phase 4 actually builds `purchases`, every confirmed-rebuy-as-duplicate case is
trivially findable (`flag_type = 'possible_duplicate' AND decision = 'import'`) and reconcilable —
merge the two `inks` rows into one, turn the second into a `purchases` entry on the survivor.

**Consequences:**
- Phase 4's `purchases` work should include a one-time reconciliation pass over historical
  possible_duplicate-imported-anyway rows, not just new-purchase support going forward. Not yet
  designed — flagged here so it isn't dropped when Phase 4 starts.
- Phase 1.1 step 3a's review UI doesn't need any purchases-aware logic — "Import anyway" stays a
  plain `decision: 'import'`, same as any other possible_duplicate resolution.
