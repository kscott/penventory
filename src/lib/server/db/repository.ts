import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AnySQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

type Db = BetterSQLite3Database<typeof schema>;
type TableWithId = AnySQLiteTable & { id: SQLiteColumn };

// Raw create + minimal read (get-by-id, list-all) shared across pens/inks/
// nibs/pen_nibs — step 5's whole scope is "support the FPC import," not a
// query layer (that's Phase 2/3). One generic implementation, not four
// near-identical copies: the operations are structurally identical
// regardless of table shape.

export function create<T extends TableWithId>(db: Db, table: T, values: T['$inferInsert']) {
	return db.insert(table).values(values).returning().get();
}

export function getById<T extends TableWithId>(db: Db, table: T, id: number) {
	return db.select().from(table).where(eq(table.id, id)).get();
}

export function listAll<T extends TableWithId>(db: Db, table: T) {
	return db.select().from(table).all();
}
