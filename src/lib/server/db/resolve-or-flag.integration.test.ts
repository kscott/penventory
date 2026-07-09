import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from './migrate';
import { resolveOrFlag } from './resolve-or-flag';
import {
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

// Same shape, same mechanism across all seven unscoped types — one
// parametrized suite covers all four outcomes for each. lines/models are
// brand-scoped (different shape, need a scopeId) and get their own suites
// below.
const UNSCOPED_TABLES = {
	brand: brands,
	pen_material: pen_materials,
	nib_material: nib_materials,
	finish: finishes,
	filling_system: filling_systems,
	nib_shape: nib_shapes,
	vendor: vendors
} as const;

describe('resolveOrFlag', () => {
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

	describe.each(Object.keys(UNSCOPED_TABLES) as (keyof typeof UNSCOPED_TABLES)[])(
		'%s (unscoped)',
		(type) => {
			const table = UNSCOPED_TABLES[type];

			it('resolves an exact, case-insensitive, whitespace-trimmed match', () => {
				const row = db.insert(table).values({ name: 'Pilot' }).returning().get();
				expect(resolveOrFlag(db, type, ' PILOT ')).toEqual({
					outcome: 'resolved',
					id: row.id,
					via: 'exact'
				});
			});

			it('resolves via a known alias', () => {
				const row = db.insert(table).values({ name: 'Pilot' }).returning().get();
				db.insert(aliases)
					.values({ alias: 'Namiki', aliasable_type: type, aliasable_id: row.id })
					.run();
				expect(resolveOrFlag(db, type, 'Namiki')).toEqual({
					outcome: 'resolved',
					id: row.id,
					via: 'alias'
				});
			});

			it('flags a character-level near-duplicate instead of creating it', () => {
				const row = db.insert(table).values({ name: 'Pilot' }).returning().get();
				expect(resolveOrFlag(db, type, 'Piolt')).toEqual({
					outcome: 'flagged',
					candidates: [{ id: row.id, name: 'Pilot', similarity: 0.8, reasons: ['fuzzy'] }]
				});
			});

			it('flags a word-contained compound name instead of creating it', () => {
				const row = db.insert(table).values({ name: 'Pilot' }).returning().get();
				const result = resolveOrFlag(db, type, 'Pilot Namiki');
				expect(result.outcome).toBe('flagged');
				if (result.outcome === 'flagged') {
					expect(result.candidates).toEqual([
						expect.objectContaining({ id: row.id, name: 'Pilot', reasons: ['contains'] })
					]);
				}
			});

			it('resolves to new when there is no match at all, even fuzzy', () => {
				db.insert(table).values({ name: 'Pilot' }).run();
				expect(resolveOrFlag(db, type, 'Sailor')).toEqual({ outcome: 'new' });
			});

			it('rejects a scopeId for an unscoped type', () => {
				expect(() => resolveOrFlag(db, type, 'Pilot', 1)).toThrow();
			});
		}
	);

	describe('line (scoped)', () => {
		it('requires a scopeId', () => {
			expect(() => resolveOrFlag(db, 'line', 'Classic')).toThrow();
		});

		it('resolves an exact match within scope', () => {
			const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
			const line = db
				.insert(lines)
				.values({ brand_id: pilot.id, name: 'Classic' })
				.returning()
				.get();
			expect(resolveOrFlag(db, 'line', 'classic', pilot.id)).toEqual({
				outcome: 'resolved',
				id: line.id,
				via: 'exact'
			});
		});

		it('resolves via a known alias within scope', () => {
			const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
			const line = db
				.insert(lines)
				.values({ brand_id: pilot.id, name: 'Custom 823' })
				.returning()
				.get();
			db.insert(aliases)
				.values({ alias: 'C823', aliasable_type: 'line', aliasable_id: line.id })
				.run();
			expect(resolveOrFlag(db, 'line', 'C823', pilot.id)).toEqual({
				outcome: 'resolved',
				id: line.id,
				via: 'alias'
			});
		});

		it('flags a near-duplicate within scope', () => {
			const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
			const line = db
				.insert(lines)
				.values({ brand_id: pilot.id, name: 'Classic' })
				.returning()
				.get();
			expect(resolveOrFlag(db, 'line', 'Classis', pilot.id)).toEqual({
				outcome: 'flagged',
				candidates: [
					{ id: line.id, name: 'Classic', similarity: expect.any(Number), reasons: ['fuzzy'] }
				]
			});
		});

		it('does not false-positive against a same-named line under a different brand (scoping respected)', () => {
			const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
			const sailor = db.insert(brands).values({ name: 'Sailor' }).returning().get();
			db.insert(lines).values({ brand_id: sailor.id, name: 'Classic' }).run();
			expect(resolveOrFlag(db, 'line', 'Classic', pilot.id)).toEqual({ outcome: 'new' });
		});
	});

	describe('model (scoped)', () => {
		it('resolves an exact match within scope', () => {
			const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
			const model = db
				.insert(models)
				.values({ brand_id: pilot.id, name: 'Custom 823' })
				.returning()
				.get();
			expect(resolveOrFlag(db, 'model', 'custom 823', pilot.id)).toEqual({
				outcome: 'resolved',
				id: model.id,
				via: 'exact'
			});
		});

		it('does not false-positive against a same-named model under a different brand (scoping respected)', () => {
			const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
			const sailor = db.insert(brands).values({ name: 'Sailor' }).returning().get();
			db.insert(models).values({ brand_id: sailor.id, name: 'Custom 823' }).run();
			expect(resolveOrFlag(db, 'model', 'Custom 823', pilot.id)).toEqual({ outcome: 'new' });
		});
	});

	it('sorts multiple flagged candidates by similarity, highest first', () => {
		// "Pilot" only word-contains the query (low character similarity);
		// "Pilot Namiky" is a 1-letter typo of it (high character similarity).
		// Both get flagged; the typo should sort first.
		const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
		const typo = db.insert(brands).values({ name: 'Pilot Namiky' }).returning().get();

		const result = resolveOrFlag(db, 'brand', 'Pilot Namiki');
		expect(result.outcome).toBe('flagged');
		if (result.outcome === 'flagged') {
			expect(result.candidates.map((c) => c.id)).toEqual([typo.id, pilot.id]);
			expect(result.candidates[0].reasons).toEqual(['fuzzy']);
			expect(result.candidates[1].reasons).toEqual(['contains']);
		}
	});

	describe('regression cases from phase1-plan.md step 3', () => {
		it('flags "Piolt" against seeded "Pilot", never auto-creating it', () => {
			const row = db.insert(brands).values({ name: 'Pilot' }).returning().get();
			expect(resolveOrFlag(db, 'brand', 'Piolt')).toEqual({
				outcome: 'flagged',
				candidates: [{ id: row.id, name: 'Pilot', similarity: 0.8, reasons: ['fuzzy'] }]
			});
		});

		it('resolves "Namiki" to "Pilot" directly via a seeded alias, not flagged at all', () => {
			const row = db.insert(brands).values({ name: 'Pilot' }).returning().get();
			db.insert(aliases)
				.values({ alias: 'Namiki', aliasable_type: 'brand', aliasable_id: row.id })
				.run();
			expect(resolveOrFlag(db, 'brand', 'Namiki')).toEqual({
				outcome: 'resolved',
				id: row.id,
				via: 'alias'
			});
		});

		it('does not false-positive a scoped near-duplicate (model) across brands', () => {
			const pilot = db.insert(brands).values({ name: 'Pilot' }).returning().get();
			const sailor = db.insert(brands).values({ name: 'Sailor' }).returning().get();
			db.insert(models).values({ brand_id: sailor.id, name: 'Custom 823' }).run();
			expect(resolveOrFlag(db, 'model', 'Custom 823', pilot.id)).toEqual({ outcome: 'new' });
		});
	});
});
