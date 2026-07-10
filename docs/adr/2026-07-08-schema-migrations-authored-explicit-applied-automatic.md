# Schema migrations: authored explicitly, verified in CI, applied automatically on startup

**Status:** Accepted

**Context:**
Two different senses of "explicit" needed different answers — authoring a migration and applying
an already-reviewed one are not the same kind of action.

**Decision:**
Authoring is explicit and gated: `drizzle-kit generate` produces committed SQL files, and a CI
drift check (folded into the `integration` job) fails if the schema changed without a
corresponding committed migration. Applying an already-committed, already-reviewed migration is
automatic on container startup (dev and the eventual homelab deployment both).

**Consequences:**
- Deliberate contrast with the FPC import: that stays Ken-triggered because it's real data with
  dedup judgment calls made in the moment, not a change already decided at commit time.
- Startup takes a backup first only when there are pending migrations to apply, not on every
  routine restart.
- Full detail in `phase1-plan.md`'s Migrations section.
