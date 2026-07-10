# `pen_nibs` and `inkings.nib_id` are independent facts, never kept in sync

**Status:** Accepted

**Context:**
Raised by Ken as a general discussion. `pen_nibs` is the formal install/removal history — a
deliberate, structural assignment. `inkings.nib_id` is a different kind of fact: `vision.md`
already establishes that Start records "pen + ink + nib matched together" as its own
independently-entered fact, not derived from whatever `pen_nibs` currently has open. In practice
a nib swap is usually just for one inking (testing a spare nib, trying a different grind) and
isn't meant as a permanent reassignment worth a formal `pen_nibs` change — so the two are
expected to diverge routinely, not as an error case.

**Decision:**
Considered three couplings: (1) fully independent, no display logic favoring either; (2) a soft
prompt at inking-Start time asking whether a mismatched nib should also update `pen_nibs`; (3)
full auto-derivation — every inking Start forces a `pen_nibs` open/close. Rejected (3) outright:
it would destroy the exact distinction being modeled (test-fit vs. permanent swap) by making
every inking leave permanent install history. Landed on (1) for the *data model* — nothing
enforces or reconciles the two — but with a specific rule for *display*: "current nib for this
pen" prefers the most recent inking's `nib_id` (by `started_on`, active or ended — a dry pen
still physically holds whatever nib was last used) over `pen_nibs`'s open row, falling back to
`pen_nibs` only when the pen has no inkings yet.

**Consequences:**
- `pen_nibs` keeps its own meaning (formal history, rarely touched — mostly just the stock nib
  from acquisition) without pretending to answer "what's really in there right now" once real
  usage exists.
- Option (2) — a soft sync prompt — stays a real option worth revisiting if drift ever becomes an
  actual problem for Ken, rather than a hypothetical one. Not built now.
- Full query rule and gate in `phase4-plan.md` step 4.
