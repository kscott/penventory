import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

const timestamps = {
	created_at: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`),
	updated_at: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
};

// --- Controlled lists (unscoped) --------------------------------------------
// Same shape, same mechanism (resolveOrFlag + aliases) — see phase1-plan.md
// step 3. Not merged into one table: each is a distinct real-world vocabulary.

export const brands = sqliteTable('brands', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const pen_materials = sqliteTable('pen_materials', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const nib_materials = sqliteTable('nib_materials', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const finishes = sqliteTable('finishes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const filling_systems = sqliteTable('filling_systems', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const nib_shapes = sqliteTable('nib_shapes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const vendors = sqliteTable('vendors', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

// --- Controlled lists (brand-scoped) ----------------------------------------
// lines/models reuse the same name across different brands legitimately
// (e.g. two brands both having a "Classic" line) — uniqueness is scoped to
// (brand_id, name), not name alone.

// Both FKs below point at the exact same target column — shared, not two
// copies of the same closure. Named (rather than inlined) so a real unit
// test can invoke it directly instead of relying on coverage-ignore comments
// for a reference Drizzle otherwise only calls during migration generation.
export const brandId = () => brands.id;

export const lines = sqliteTable(
	'lines',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		brand_id: integer('brand_id').notNull().references(brandId),
		name: text('name').notNull(),
		...timestamps
	},
	(t) => [unique().on(t.brand_id, t.name)]
);

export const models = sqliteTable(
	'models',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		brand_id: integer('brand_id').notNull().references(brandId),
		name: text('name').notNull(),
		...timestamps
	},
	(t) => [unique().on(t.brand_id, t.name)]
);

// --- Aliases -----------------------------------------------------------------
// Polymorphic: one table instead of nine near-identical per-type alias
// tables. aliasable_id intentionally has no DB-level foreign key — it points
// at a different table depending on aliasable_type, which SQLite can't
// express as a single FK constraint. Resolution (alias -> canonical row) is
// an application-layer join in resolveOrFlag (step 3), not enforced here.

export const ALIASABLE_TYPES = [
	'brand',
	'line',
	'model',
	'pen_material',
	'nib_material',
	'finish',
	'filling_system',
	'nib_shape',
	'vendor'
] as const;
export type AliasableType = (typeof ALIASABLE_TYPES)[number];

export const aliases = sqliteTable(
	'aliases',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		alias: text('alias').notNull(),
		aliasable_type: text('aliasable_type', { enum: ALIASABLE_TYPES }).notNull(),
		aliasable_id: integer('aliasable_id').notNull(),
		...timestamps
	},
	(t) => [unique().on(t.alias, t.aliasable_type)]
);

// --- Import audit log --------------------------------------------------------
// Append-only: a row is written once, at the end of a dry-run or commit, and
// never updated — run_at is the one timestamp that means anything here, so
// this deliberately skips the created_at/updated_at pair every mutable
// catalog table above gets.

export const IMPORT_OPERATION_TYPES = ['catalog_import', 'color_refresh'] as const;
export type ImportOperationType = (typeof IMPORT_OPERATION_TYPES)[number];

export const IMPORT_MODES = ['dry_run', 'commit'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const import_runs = sqliteTable('import_runs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	operation_type: text('operation_type', { enum: IMPORT_OPERATION_TYPES }).notNull(),
	mode: text('mode', { enum: IMPORT_MODES }).notNull(),
	report_summary: text('report_summary', { mode: 'json' }).$type<Record<string, unknown>>(),
	run_at: integer('run_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(CURRENT_TIMESTAMP)`)
});
