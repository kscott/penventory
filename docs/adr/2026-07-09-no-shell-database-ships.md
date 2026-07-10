# No shell database ships as a deploy artifact; startup migrations create the schema from nothing

**Status:** Accepted

**Context:**
Restates and confirms [[2026-07-08-db-file-never-in-deploy-artifact]] rather than changing it —
made explicit because Ken asked directly whether an empty shell database needed distributing.

**Decision:**
SQLite creates the file itself, at the driver level, the first time something opens a connection
to a path that doesn't yet exist — not something a migration or Drizzle has to do. On a genuinely
fresh volume: the app opens `DATABASE_URL`, `better-sqlite3` creates an empty file at that path,
then the already-decided apply-on-startup migration logic runs every committed migration file in
order against that connection, building the full schema from empty.

**Consequences:**
- Nothing about this needs a distributed "shell" `.db` file, and nothing changes about how
  backup/volumes work.
