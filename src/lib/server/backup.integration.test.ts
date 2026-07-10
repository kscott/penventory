import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDatabase } from './backup';
import { migrateDatabase } from './db/migrate';
import { brands } from './db/schema';

describe('backupDatabase', () => {
	let dir: string;
	let sqlite: Database.Database;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'penventory-test-'));
		sqlite = new Database(join(dir, `${randomUUID()}.db`));
		sqlite.pragma('foreign_keys = ON');
		const db = migrateDatabase(sqlite);
		db.insert(brands).values({ name: 'Pilot' }).run();
	});

	afterEach(() => {
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('creates a real, independently-readable backup containing the current data', async () => {
		const backupDir = join(dir, 'backups');
		const backupPath = await backupDatabase(sqlite, backupDir);

		expect(existsSync(backupPath)).toBe(true);

		const backupSqlite = new Database(backupPath, { readonly: true });
		const rows = backupSqlite.prepare('SELECT name FROM brands').all() as { name: string }[];
		backupSqlite.close();

		expect(rows).toEqual([{ name: 'Pilot' }]);
	});

	it('creates the backup directory when it does not already exist', async () => {
		const backupDir = join(dir, 'nested', 'backups');
		const backupPath = await backupDatabase(sqlite, backupDir);
		expect(existsSync(backupPath)).toBe(true);
	});
});
