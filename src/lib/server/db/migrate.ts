import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export function migrateDatabase(sqlite: Database.Database) {
	const db = drizzle({ client: sqlite, schema });
	migrate(db, { migrationsFolder: './drizzle' });
	return db;
}
