# Penventory — Phase 2 Plan: Visual browse

Per the vision doc's build-sequencing decision, this is "the actual point of building
an app" — the visual browsing/reshuffling experience is a source of joy independent of
any ledger or AI feature. All five views run entirely off `ink.color` hex values —
real ones, populated via Phase 1.1's web import feature, not Phase 1's fixture-only
service logic (see `docs/adr/2026-07-09-no-cli-at-all-for-import.md`) — no photo
pipeline dependency.

Auth already exists by this point — built in Phase 1.1 (needed there first, since that's
the first web-reachable feature mutating real data), not repeated here. Every route in
this phase is gated by it.

Color Family, Color Wheel, Tone, and Brand A–Z are primary/day-one (per vision doc
§6.4). Near-Dupes is an explicit second wave, listed last here for that reason, not
because it's less important.

## Ordered steps

1. **Deploy plumbing.** New CI job: push image to GHCR on merge to `main` (added to
   the existing Phase-0 workflow file — not a new workflow). Portainer
   `secondo/personal-apps` git-stack created, pointed at the homelab repo, polling for
   new images, with Penventory's `/metrics` port actually published to the host
   network (not just reachable inside the container) — Prometheus can't scrape what
   isn't network-reachable from Quarto. This is the first phase producing something
   worth actually running.

   **Wiring up the scrape is not this container's job — Prometheus is a pull system,
   and the existing stack uses static config, not service discovery.** Nothing here
   announces itself. A separate, manual edit to the **homelab repo** (not this one) —
   adding a `job_name: penventory` block to Quarto's `prometheus.yml`, targeting
   Secondo's hostname/port, alongside the existing static targets (node-exporter,
   cadvisor, Uptime Kuma, opnsense-exporter) — is what actually makes this happen.
   Portainer's git-stack polling redeploys Prometheus with the new config once that's
   committed. This is homelab-infrastructure work adjacent to Penventory, not a
   Penventory deliverable.
   *Gate:* manual, one-time — `/verify` (image appears in GHCR, Portainer redeploys,
   Prometheus target shows up on `/targets`). Not CI-testable, same as Phase 1's local
   import run.

2. **Color Family view.** Service ports `gen_inks.py`'s hue/saturation/lightness → 7
   color families + Neutrals & Grays bucketing (`lib/server/services/colorFamily.ts`) —
   a pure function over `ink.color`, no other DB dependency. Route + UI grid grouped by
   family.
   *Gate:* unit tests (~15+ fixed hex → expected-family cases, including boundary
   hues); contract test (route shape against seeded data); Playwright test (groups
   render).

3. **Color Wheel view.** Service sorts by hue angle (colorjs.io hex → LCH conversion).
   *Gate:* same three tiers as step 2.

4. **Tone view.** Service buckets by lightness into 5 named bands (Dark /
   Medium-Dark / Medium / Light / Pastel).
   *Gate:* unit-test the band boundaries explicitly; same tiers as step 2.

5. **Brand A–Z view.** Thinnest slice — repo query + alphabetical group-by-brand sort.
   Still gets its own service function; routes stay HTTP-only even when the logic is
   small.
   *Gate:* same tiers as step 2.

6. **Reshuffle/reflow animation.** One shared ink-grid component, Svelte
   `animate:flip` keyed by ink id, reused across all four views above — this is the
   single feature the framework choice was made for.
   *Gate:* Playwright test switches between two views, asserts the DOM order changes
   to match the new view's sort. Not a pixel/timing assertion — correctness of the end
   state and that a transition is wired.

7. **Near-Dupes view (second wave).** Service computes CIE Lab conversion + pairwise
   ΔE (colorjs.io) across the whole collection, ports the
   threshold-cluster/re-split-oversized-clusters algorithm from `gen_inks.py`, plus the
   per-ink uniqueness score (0–10, nearest-neighbor distance) and the Nearly
   identical/Very similar/Similar/Noticeable labels.
   *Gate:* unit tests with known color-pair fixtures and expected ΔE bands; a
   synthetic-collection test that specifically exercises the oversized-cluster
   re-split path; same contract/Playwright tiers as the others.
   *Note:* O(n²) pairwise ΔE across ~276+ inks is cheap at this scale — no caching or
   pagination built for this now; flagged as an assumption, revisit only if the
   collection grows an order of magnitude.

## Definition of done

All five views live, sharing one animated grid component, running on Secondo via the
new GHCR/Portainer deploy path, gated behind the login Phase 1.1 already built. No
ledger, ratings, or AI in this phase — pen/ink/color data only, populated for real via
Phase 1.1's import feature.
