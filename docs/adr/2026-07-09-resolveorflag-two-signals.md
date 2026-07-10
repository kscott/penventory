# `resolveOrFlag`'s outcome-3 flagging uses two independent signals, not one

**Status:** Accepted

**Context:**
Character-level Damerau-Levenshtein similarity (threshold 0.7, chosen to clear the plan's
"Piolt"/"Pilot" case at 0.8 while leaving unrelated short names like "Pilot"/"Sailor" well below
it) only catches typos of a name that's otherwise the same shape. Walking through it with Ken
surfaced a second, different-shaped drift pattern it misses entirely: compound/legal-name
variants. "Pilot" vs. "Pilot Namiki" scores 0.42 — nowhere near the threshold — because it's not
a typo, it's the same word plus more. Left alone, that case would fall straight through to
outcome 4 and get silently created as a brand-new, unrelated brand.

**Decision:**
Ken's framing: `resolveOrFlag` should be biased toward finding a reason to match a known value,
not toward assuming novelty. Added a second signal, `containsAsWords` — true when every word of
the shorter (normalized) name appears, in order, among the longer name's words ("pilot" ⊆ "pilot
namiki"; also catches non-contiguous compounds like "pilot company" ⊆ "pilot pen company").
Either signal flags a candidate; neither auto-creates or auto-resolves.

**Consequences:**
- Each flagged candidate in `ResolveCandidate.reasons` records which signal(s) caught it
  (`'fuzzy' | 'contains'`, both possible at once), so the review report can show why.
- Also checked, walking through it with Ken: character-level near-misses between two real,
  distinct names (e.g. "Platinum" vs. "Platignum," both real vendors, similarity 0.89) don't
  create ongoing flagging friction — outcomes are checked in order, exact match before fuzzy. The
  first time "Platignum" appears against only "Platinum" on file, it's flagged once; once Ken
  confirms it's genuinely different and it exists as its own canonical row, every subsequent
  "Platignum" hits exact match and resolves silently forever after. No "confirmed distinct, stop
  flagging" mechanism needed — the one-time cost was already the whole design.
