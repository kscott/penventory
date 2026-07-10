# The SQLite database file is never part of the deploy artifact

**Status:** Accepted

**Context:**
Restates `project-plan.md`'s existing Volumes design as an explicit hard rule, made necessary
once import tooling started depending on it being true in any environment.

**Decision:**
The DB path always points at a persistent volume that exists independently of the app image. No
install or update — local dev, or the eventual homelab deployment — creates, resets, or touches
it except through an explicit, Ken-initiated action like the import.

**Consequences:**
- Local Mac/container work during development is not the real production instance; that's the
  homelab deployment, stood up later.
- Sets up [[2026-07-09-no-shell-database-ships]] and
  [[2026-07-09-no-shell-ssh-operational-rule]].
