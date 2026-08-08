import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brands } from './schema';

// instance.ts memoizes its connection in a module-scope variable (the whole
// point of the lazy singleton — see its own comment on why eager
// createDbClient() broke the Docker build). That means, unlike
// client.integration.test.ts's createDbClient (no caching of its own), tests
// here need a genuinely fresh module instance each time — resetModules() +
// a dynamic re-import — or every test after the first would just observe the
// first test's already-open connection.
function restoreDatabaseUrl(value: string | undefined) {
	if (value === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = value;
}

describe('instance (lazy db singleton)', () => {
	let dir: string;
	const originalDatabaseUrl = process.env.DATABASE_URL;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'penventory-instance-test-'));
		process.env.DATABASE_URL = `file:${join(dir, 'penventory.db')}`;
		vi.resetModules();
	});

	afterEach(() => {
		restoreDatabaseUrl(originalDatabaseUrl);
		rmSync(dir, { recursive: true, force: true });
	});

	it('getDb() opens a real, migrated connection at the DATABASE_URL path', async () => {
		const { getDb, getSqlite } = await import('./instance');
		const db = getDb();
		try {
			expect(db.select().from(brands).all()).toEqual([]);
		} finally {
			getSqlite().close();
		}
	});

	it('getSqlite() returns the real file connection, foreign_keys on', async () => {
		const { getSqlite } = await import('./instance');
		const sqlite = getSqlite();
		try {
			expect(existsSync(join(dir, 'penventory.db'))).toBe(true);
			expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
		} finally {
			sqlite.close();
		}
	});

	it('memoizes — repeated calls return the exact same instances, not a fresh connection each time', async () => {
		const { getDb, getSqlite } = await import('./instance');
		try {
			expect(getDb()).toBe(getDb());
			expect(getSqlite()).toBe(getSqlite());
		} finally {
			getSqlite().close();
		}
	});
});
