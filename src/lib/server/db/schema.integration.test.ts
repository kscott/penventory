import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from './migrate';
import {
	ALIASABLE_TYPES,
	aliases,
	brands,
	filling_systems,
	finishes,
	lines,
	models,
	nib_materials,
	nib_shapes,
	pen_materials,
	vendors
} from './schema';

// Unscoped controlled-list tables — one shared shape, resolution tested via
// a single parametrized case below. lines/models are brand-scoped (different
// shape) and get their own explicit cases further down.
const CANONICAL_TABLES = {
	brand: brands,
	pen_material: pen_materials,
	nib_material: nib_materials,
	finish: finishes,
	filling_system: filling_systems,
	nib_shape: nib_shapes,
	vendor: vendors
} as const;

describe('controlled-list schema', () => {
	let dir: string;
	let sqlite: Database.Database;
	let db: ReturnType<typeof migrateDatabase>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'penventory-test-'));
		sqlite = new Database(join(dir, `${randomUUID()}.db`));
		sqlite.pragma('foreign_keys = ON');
		db = migrateDatabase(sqlite);
	});

	afterEach(() => {
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('applies the real migration files cleanly from zero', () => {
		const tables = sqlite
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'"
			)
			.all() as { name: string }[];
		expect(tables.map((t) => t.name).sort()).toEqual(
			[
				'aliases',
				'brands',
				'filling_systems',
				'finishes',
				'import_runs',
				'lines',
				'models',
				'nib_materials',
				'nib_shapes',
				'pen_materials',
				'vendors'
			].sort()
		);
	});

	it('enforces foreign keys on lines.brand_id', () => {
		expect(() => db.insert(lines).values({ brand_id: 9999, name: 'Nonexistent' }).run()).toThrow();
	});

	it('enforces foreign keys on models.brand_id', () => {
		expect(() => db.insert(models).values({ brand_id: 9999, name: 'Nonexistent' }).run()).toThrow();
	});

	it('enforces uniqueness on unscoped controlled-list names', () => {
		db.insert(brands).values({ name: 'Pilot' }).run();
		expect(() => db.insert(brands).values({ name: 'Pilot' }).run()).toThrow();
	});

	it('scopes line/model uniqueness to (brand_id, name), not name alone', () => {
		const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
		const sailor = db.insert(brands).values({ name: 'Sailor' }).returning().get();

		db.insert(lines).values({ brand_id: pilot.id, name: 'Classic' }).run();
		// Same name, different brand — must succeed, not false-positive as a duplicate.
		expect(() =>
			db.insert(lines).values({ brand_id: sailor.id, name: 'Classic' }).run()
		).not.toThrow();
		// Same name, same brand — must fail.
		expect(() => db.insert(lines).values({ brand_id: pilot.id, name: 'Classic' }).run()).toThrow();
	});

	it('enforces uniqueness on (alias, aliasable_type)', () => {
		const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
		db.insert(aliases)
			.values({ alias: 'Namiki', aliasable_type: 'brand', aliasable_id: pilot.id })
			.run();
		expect(() =>
			db
				.insert(aliases)
				.values({ alias: 'Namiki', aliasable_type: 'brand', aliasable_id: pilot.id })
				.run()
		).toThrow();
	});

	it('confirms ALIASABLE_TYPES covers exactly the nine controlled-list types', () => {
		expect([...ALIASABLE_TYPES].sort()).toEqual(
			[
				'brand',
				'line',
				'model',
				'pen_material',
				'nib_material',
				'finish',
				'filling_system',
				'nib_shape',
				'vendor'
			].sort()
		);
	});

	it.each(Object.keys(CANONICAL_TABLES) as (keyof typeof CANONICAL_TABLES)[])(
		'resolves an alias to its canonical %s row',
		(type) => {
			const table = CANONICAL_TABLES[type];
			const canonical = db
				.insert(table)
				.values({ name: `Canonical ${type}` })
				.returning()
				.get();
			db.insert(aliases)
				.values({ alias: `Alt name for ${type}`, aliasable_type: type, aliasable_id: canonical.id })
				.run();

			const resolved = db
				.select()
				.from(aliases)
				.where(and(eq(aliases.alias, `Alt name for ${type}`), eq(aliases.aliasable_type, type)))
				.get();
			expect(resolved?.aliasable_id).toBe(canonical.id);

			const canonicalRow = db
				.select()
				.from(table)
				.where(eq(table.id, resolved!.aliasable_id))
				.get();
			expect(canonicalRow?.name).toBe(`Canonical ${type}`);
		}
	);

	it('resolves an alias to its canonical line row (brand-scoped)', () => {
		const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
		const line = db
			.insert(lines)
			.values({ brand_id: pilot.id, name: 'Custom 823' })
			.returning()
			.get();
		db.insert(aliases)
			.values({ alias: 'C823', aliasable_type: 'line', aliasable_id: line.id })
			.run();

		const resolved = db
			.select()
			.from(aliases)
			.where(and(eq(aliases.alias, 'C823'), eq(aliases.aliasable_type, 'line')))
			.get();
		const canonicalRow = db.select().from(lines).where(eq(lines.id, resolved!.aliasable_id)).get();
		expect(canonicalRow?.name).toBe('Custom 823');
		expect(canonicalRow?.brand_id).toBe(pilot.id);
	});

	it('resolves an alias to its canonical model row (brand-scoped)', () => {
		const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
		const model = db
			.insert(models)
			.values({ brand_id: pilot.id, name: 'Custom 823' })
			.returning()
			.get();
		db.insert(aliases)
			.values({ alias: 'CM823', aliasable_type: 'model', aliasable_id: model.id })
			.run();

		const resolved = db
			.select()
			.from(aliases)
			.where(and(eq(aliases.alias, 'CM823'), eq(aliases.aliasable_type, 'model')))
			.get();
		const canonicalRow = db
			.select()
			.from(models)
			.where(eq(models.id, resolved!.aliasable_id))
			.get();
		expect(canonicalRow?.name).toBe('Custom 823');
		expect(canonicalRow?.brand_id).toBe(pilot.id);
	});
});
