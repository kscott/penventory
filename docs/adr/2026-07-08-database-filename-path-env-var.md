# Database filename, path, and env var settled

**Status:** Accepted

**Context:**
`project-plan.md`'s backup command used `penventory.db` only as an illustrative example — never
an actual decided config value, and no env var name existed anywhere. Needed now because Phase 1
step 2 (Drizzle config/migrations) and the Dockerfile volume mount both depend on a real value.

**Decision:**
Filename `penventory.db`; dev path `./data/penventory.db` (gitignored); container volume mount
`/data/penventory.db`; env var `DATABASE_URL` (Drizzle's own convention, even though SQLite isn't
a network URL) holding `file:./data/penventory.db`.

**Consequences:**
None beyond the fix itself.
