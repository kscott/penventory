# Penventory — Phase 5 Plan: AI-assisted suggestions

The vision doc leaves the technical shape of Claude's access to Penventory's data
deliberately undecided until this point. This phase starts by resolving that, then
builds the suggestion features on top — grounded, provenance-tracked, and never
blended with Ken's own entries, per the vision doc's explicit rules.

## Ordered steps

1. **Decision step (no code).** Lock in: Claude accesses Penventory via a
   Zod-validated HTTP API under `/api/` — not a bespoke skill-only mechanism. The app
   itself never calls an LLM; Claude-the-agent is the sole consumer/reasoner over this
   API. Record this in `ARCHITECTURE.md`'s decision log.
   This is the load-bearing decision for the rest of the phase: it's what keeps every
   service below fully unit-testable with zero live external dependency — the "no
   code path may require live external system state to test" rule would otherwise be
   at risk the moment "AI" enters the picture.
   *Gate:* none — a decision, recorded.

2. **`ai_suggestion_logs` table (new).** `id, intent, input_context (json),
   cited_record_ids (json), sample_size, response_summary, created_at`. Append-only
   provenance log — never joined into or blended with `inkings`, notes, or ratings.
   This is what makes "AI-derived content stays strictly separate from what Ken enters
   himself" a concrete, queryable fact instead of just a policy.
   *Gate:* full DoD tiers for schema/repo/service (append-only writer)/route.

3. **Candidate-selection services.** Deterministic, no LLM call in-app — fully
   unit-testable against fixture ledger data:
   - **Old favorite** — ranks by rating + the "old favorite" tag over raw refill
     frequency, per the vision doc's explicit rule that explicit enjoyment outweighs
     frequency alone.
   - **Something new** — ranks unused/rarely-used pens, inks, and never-tried
     pen+ink combinations.
   - **Find a match** (given an ink → suggest pen+nib) — ranks by past pairing
     performance/rating for that specific ink.
   - **Aesthetic match** — pen photo color evaluated **fresh at request time**
     (reuses Phase 3's swatch-extraction service, called live, never cached or
     stored per-pen) vs. ink color, ΔE-based complement/match scoring.

   *Gate:* every response shape is asserted directly in unit tests:
   - length ≥ 2 when data allows — never a single confident pick, per the vision
     doc's "don't tell me what to do" requirement
   - always includes cited record IDs (which inkings, which dates, which notes)
   - always includes sample size, with an explicit test for the low-data case
     ("only used once, too early to tell" reads differently from a confident answer)

4. **Routes exposing the above as the documented contract.** Choosing a suggested
   option calls Phase 4's existing inkings-create service directly (creates the real
   Start entry) — no new write path, no duplicate logic.
   *Gate:* contract tests against the Zod schemas for every endpoint.

## Definition of done

Claude can query pairing suggestions and ledger data through a documented, tested API.
Every suggestion is traceable to specific source records with sample size shown.
Nothing AI-derived is ever written into Ken's own notes/rating/checkbox fields — the
`ai_suggestion_logs` table is the only place AI output lives.
