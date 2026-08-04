import Database from 'better-sqlite3';
import { migrateDatabase } from './migrate';

// Same DATABASE_URL convention drizzle.config.ts already uses — Drizzle's
// own naming, even though SQLite isn't a network URL. See
// docs/adr/2026-07-08-database-filename-path-env-var.md.
const DEFAULT_DATABASE_URL = 'file:./data/penventory.db';

// Pure and side-effect-free on purpose — lets the default-fallback and
// file:-stripping logic be tested directly, without opening a real
// connection at the real dev-default path.
export function resolveDatabasePath(
	databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
) {
	return databaseUrl.replace(/^file:/, '');
}

// The first and only place in the app that opens a real, non-temp-file
// connection — every other module takes a db/sqlite handle as a parameter
// (see the repository layer). SQLite creates the file itself on first open
// if it doesn't exist yet (see docs/adr/2026-07-09-no-shell-database-ships.md),
// then migrateDatabase runs every committed migration against it, building
// the full schema from empty on a genuinely fresh volume.
export function createDbClient() {
	const sqlite = new Database(resolveDatabasePath());
	// Resolves docs/punch-list.md's foreign_keys pragma gap — merge_into/
	// decision_target_id relies entirely on FK enforcement to fail loudly on
	// a dangling reference rather than silently writing an orphan, and that
	// only holds if the real production connection sets this.
	sqlite.pragma('foreign_keys = ON');
	const db = migrateDatabase(sqlite);
	return { sqlite, db };
}
