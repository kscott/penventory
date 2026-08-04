import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDbClient, resolveDatabasePath } from './client';
import { brands } from './schema';

// Not a mocked or in-memory stand-in — a real file path, exercising the
// exact env-var-to-connection wiring the real app uses at startup, the same
// standard every other integration test in this codebase already holds
// (docs/adr/2026-07-08-no-live-external-state-in-tests.md's counterpart:
// state IS real here, just disposable).
function restoreDatabaseUrl(value: string | undefined) {
	// process.env coerces an assigned `undefined` to the literal string
	// "undefined" — delete is the only correct way to restore an unset var.
	if (value === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = value;
}

describe('createDbClient', () => {
	let dir: string | null = null;
	const originalDatabaseUrl = process.env.DATABASE_URL;

	afterEach(() => {
		restoreDatabaseUrl(originalDatabaseUrl);
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = null;
	});

	it('opens a real file at the path DATABASE_URL names, creating it if it does not exist yet', () => {
		dir = mkdtempSync(join(tmpdir(), 'penventory-client-test-'));
		const dbPath = join(dir, 'penventory.db');
		process.env.DATABASE_URL = `file:${dbPath}`;

		const { sqlite, db } = createDbClient();
		try {
			expect(existsSync(dbPath)).toBe(true);
			// migrateDatabase actually ran — the schema exists, not just an
			// empty file.
			expect(db.select().from(brands).all()).toEqual([]);
			// The real production connection sets this — see
			// docs/punch-list.md's now-resolved foreign_keys gap.
			expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
		} finally {
			sqlite.close();
		}
	});
});

describe('resolveDatabasePath', () => {
	const originalDatabaseUrl = process.env.DATABASE_URL;

	afterEach(() => {
		restoreDatabaseUrl(originalDatabaseUrl);
	});

	it('strips the file: prefix from an explicit DATABASE_URL', () => {
		expect(resolveDatabasePath('file:./data/penventory.db')).toBe('./data/penventory.db');
	});

	it('falls back to the documented dev-default path when DATABASE_URL is unset', () => {
		delete process.env.DATABASE_URL;
		expect(resolveDatabasePath()).toBe('./data/penventory.db');
	});
});
