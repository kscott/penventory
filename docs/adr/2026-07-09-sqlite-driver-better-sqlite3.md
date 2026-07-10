# SQLite driver: `better-sqlite3`, not `@libsql/client`

**Status:** Accepted

**Context:**
`project-plan.md` said "Drizzle ORM" but never named the underlying client — a real gap, since it
decides how the database file actually comes into existence.

**Decision:**
`better-sqlite3` — synchronous, no network/remote-sync layer (unlike `@libsql/client`, built for
Turso's embedded-replica use case this project doesn't have), and the driver Drizzle's own
SQLite docs lead with.

**Consequences:**
- Fits the existing "single file, single user" and
  [[2026-07-08-no-live-external-state-in-tests]] rules cleanly.
