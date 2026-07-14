import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from './migrate';
import {
	aliases,
	brands,
	filling_systems,
	finishes,
	inks,
	lines,
	models,
	nib_base_sizes,
	nib_materials,
	nib_point_sizes,
	nib_purities,
	nib_shapes,
	nibs,
	FINISH_SEED,
	NIB_BASE_SIZE_SEED,
	NIB_MATERIAL_SEED,
	NIB_POINT_SIZE_SEED,
	NIB_PURITY_SEED,
	NIB_SHAPE_SEED,
	pen_materials,
	pens,
	taggables,
	tags,
	vendors
} from './schema';

describe('core catalog schema (pens/inks/nibs/tags)', () => {
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

	// One row per controlled-list dependency, shared across tests rather than
	// repeated in each one.
	function seedControlledLists() {
		const brand = db.insert(brands).values({ name: 'Pilot' }).returning().get();
		const model = db
			.insert(models)
			.values({ brand_id: brand.id, name: 'Custom 823' })
			.returning()
			.get();
		const line = db
			.insert(lines)
			.values({ brand_id: brand.id, name: 'Iroshizuku' })
			.returning()
			.get();
		const penMaterial = db.insert(pen_materials).values({ name: 'Acrylic' }).returning().get();
		const finish = db.insert(finishes).values({ name: 'Rhodium' }).returning().get();
		const fillingSystem = db.insert(filling_systems).values({ name: 'Piston' }).returning().get();
		// Gold/Round are pre-seeded by migration now — select rather than
		// insert, same pattern as purity/baseSize/pointSize below.
		const nibMaterial = db
			.select()
			.from(nib_materials)
			.where(eq(nib_materials.name, 'Gold'))
			.get()!;
		const nibShape = db.select().from(nib_shapes).where(eq(nib_shapes.name, 'Round')).get()!;
		const vendor = db.insert(vendors).values({ name: 'PenRealm' }).returning().get();
		const purity = db.select().from(nib_purities).where(eq(nib_purities.name, '14K')).get()!;
		const baseSize = db.select().from(nib_base_sizes).where(eq(nib_base_sizes.name, '#6')).get()!;
		const pointSize = db.select().from(nib_point_sizes).where(eq(nib_point_sizes.name, 'M')).get()!;
		return {
			brand,
			model,
			line,
			penMaterial,
			finish,
			fillingSystem,
			nibMaterial,
			nibShape,
			vendor,
			purity,
			baseSize,
			pointSize
		};
	}

	it('seeds the known nib_purities/nib_base_sizes/nib_point_sizes values on migration', () => {
		const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();
		expect(names(db.select().from(nib_purities).all())).toEqual([...NIB_PURITY_SEED].sort());
		expect(names(db.select().from(nib_base_sizes).all())).toEqual([...NIB_BASE_SIZE_SEED].sort());
		expect(names(db.select().from(nib_point_sizes).all())).toEqual([...NIB_POINT_SIZE_SEED].sort());
	});

	it('seeds the known nib_shapes/nib_materials/finishes vocabulary on migration, plus the Journaler alias', () => {
		const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();
		expect(names(db.select().from(nib_shapes).all())).toEqual([...NIB_SHAPE_SEED].sort());
		expect(names(db.select().from(nib_materials).all())).toEqual([...NIB_MATERIAL_SEED].sort());
		expect(names(db.select().from(finishes).all())).toEqual([...FINISH_SEED].sort());

		const cursiveItalic = db
			.select()
			.from(nib_shapes)
			.where(eq(nib_shapes.name, 'Cursive Italic'))
			.get()!;
		const journalerAlias = db
			.select()
			.from(aliases)
			.where(and(eq(aliases.alias, 'Journaler'), eq(aliases.aliasable_type, 'nib_shape')))
			.get();
		expect(journalerAlias?.aliasable_id).toBe(cursiveItalic.id);

		const goldTone = db.select().from(finishes).where(eq(finishes.name, 'Gold Tone')).get()!;
		const silverTone = db.select().from(finishes).where(eq(finishes.name, 'Silver Tone')).get()!;
		const goldAlias = db
			.select()
			.from(aliases)
			.where(and(eq(aliases.alias, 'Gold'), eq(aliases.aliasable_type, 'finish')))
			.get();
		const silverAlias = db
			.select()
			.from(aliases)
			.where(and(eq(aliases.alias, 'Silver'), eq(aliases.aliasable_type, 'finish')))
			.get();
		expect(goldAlias?.aliasable_id).toBe(goldTone.id);
		expect(silverAlias?.aliasable_id).toBe(silverTone.id);
	});

	describe('pens', () => {
		function validValues(f: ReturnType<typeof seedControlledLists>) {
			return {
				brand_id: f.brand.id,
				model_id: f.model.id,
				color: 'Primary Manipulation 5.5',
				material_id: f.penMaterial.id,
				trim_color_id: f.finish.id,
				filling_system_id: f.fillingSystem.id,
				size_category: 'standard' as const,
				condition: 'new' as const,
				ownership_state: 'active' as const
			};
		}

		it('creates a row resolving every foreign key', () => {
			const f = seedControlledLists();
			const pen = db.insert(pens).values(validValues(f)).returning().get();
			expect(pen.id).toBeTypeOf('number');
		});

		it('accepts null size_category and condition — FPC import (step 6) has no source column for either', () => {
			const f = seedControlledLists();
			const pen = db
				.insert(pens)
				.values({
					brand_id: f.brand.id,
					model_id: f.model.id,
					color: 'Primary Manipulation 5.5',
					material_id: f.penMaterial.id,
					trim_color_id: f.finish.id,
					filling_system_id: f.fillingSystem.id,
					ownership_state: 'active'
				})
				.returning()
				.get();
			expect(pen.size_category).toBeNull();
			expect(pen.condition).toBeNull();
		});

		it('accepts a null trim_color_id — real, confirmed case: some pens have no plated trim hardware at all', () => {
			const f = seedControlledLists();
			const pen = db
				.insert(pens)
				.values({
					brand_id: f.brand.id,
					model_id: f.model.id,
					color: 'Primary Manipulation 5.5',
					material_id: f.penMaterial.id,
					filling_system_id: f.fillingSystem.id,
					ownership_state: 'active'
				})
				.returning()
				.get();
			expect(pen.trim_color_id).toBeNull();
		});

		it.each(['brand_id', 'model_id', 'material_id', 'trim_color_id', 'filling_system_id'] as const)(
			'enforces the %s foreign key',
			(column) => {
				const f = seedControlledLists();
				const values = { ...validValues(f), [column]: 999999 };
				expect(() => db.insert(pens).values(values).run()).toThrow();
			}
		);
	});

	describe('inks', () => {
		function validValues(f: ReturnType<typeof seedControlledLists>) {
			return {
				brand_id: f.brand.id,
				line_id: f.line.id,
				name: 'Kon-peki',
				type: 'bottle' as const,
				color_fpc: '#123456',
				ownership_state: 'active' as const
			};
		}

		it('creates a row resolving every foreign key', () => {
			const f = seedControlledLists();
			const ink = db.insert(inks).values(validValues(f)).returning().get();
			expect(ink.id).toBeTypeOf('number');
		});

		it('accepts a null maker_id', () => {
			const f = seedControlledLists();
			const ink = db.insert(inks).values(validValues(f)).returning().get();
			expect(ink.maker_id).toBeNull();
		});

		it('accepts a null line_id — real, confirmed case: FPC leaves Line blank for most inks', () => {
			const f = seedControlledLists();
			const ink = db
				.insert(inks)
				.values({
					brand_id: f.brand.id,
					name: 'Kon-peki',
					type: 'bottle',
					color_fpc: '#123456',
					ownership_state: 'active'
				})
				.returning()
				.get();
			expect(ink.line_id).toBeNull();
		});

		it('resolves maker_id when set — reuses brands directly, not a separate table', () => {
			const f = seedControlledLists();
			const maker = db.insert(brands).values({ name: 'Sailor' }).returning().get();
			const ink = db
				.insert(inks)
				.values({ ...validValues(f), maker_id: maker.id })
				.returning()
				.get();
			expect(ink.maker_id).toBe(maker.id);
		});

		it.each(['brand_id', 'line_id'] as const)('enforces the %s foreign key', (column) => {
			const f = seedControlledLists();
			const values = { ...validValues(f), [column]: 999999 };
			expect(() => db.insert(inks).values(values).run()).toThrow();
		});

		it('enforces the maker_id foreign key when set', () => {
			const f = seedControlledLists();
			expect(() =>
				db
					.insert(inks)
					.values({ ...validValues(f), maker_id: 999999 })
					.run()
			).toThrow();
		});
	});

	describe('nibs', () => {
		function validValues(f: ReturnType<typeof seedControlledLists>) {
			return {
				brand_id: f.brand.id,
				manufacturer_id: f.brand.id,
				material_id: f.nibMaterial.id,
				purity_id: f.purity.id,
				base_size_id: f.baseSize.id,
				point_size_id: f.pointSize.id,
				shape_id: f.nibShape.id,
				finish_id: f.finish.id,
				nibmeister_id: f.vendor.id
			};
		}

		it('creates a row resolving every foreign key', () => {
			const f = seedControlledLists();
			const nib = db.insert(nibs).values(validValues(f)).returning().get();
			expect(nib.id).toBeTypeOf('number');
		});

		it('accepts brand_id and manufacturer_id pointing at the same brand row — a vertically-integrated maker (e.g. Pilot) is genuinely both', () => {
			const f = seedControlledLists();
			const nib = db.insert(nibs).values(validValues(f)).returning().get();

			expect(nib.brand_id).toBe(f.brand.id);
			expect(nib.manufacturer_id).toBe(f.brand.id);
		});

		it('accepts brand_id, manufacturer_id, purity_id, finish_id, and nibmeister_id all null', () => {
			const f = seedControlledLists();
			const nib = db
				.insert(nibs)
				.values({
					material_id: f.nibMaterial.id,
					base_size_id: f.baseSize.id,
					point_size_id: f.pointSize.id,
					shape_id: f.nibShape.id
				})
				.returning()
				.get();

			expect(nib.brand_id).toBeNull();
			expect(nib.manufacturer_id).toBeNull();
			expect(nib.purity_id).toBeNull();
			expect(nib.finish_id).toBeNull();
			expect(nib.nibmeister_id).toBeNull();
		});

		it.each([
			'brand_id',
			'manufacturer_id',
			'material_id',
			'purity_id',
			'base_size_id',
			'point_size_id',
			'shape_id',
			'finish_id',
			'nibmeister_id'
		] as const)('enforces the %s foreign key', (column) => {
			const f = seedControlledLists();
			const values = { ...validValues(f), [column]: 999999 };
			expect(() => db.insert(nibs).values(values).run()).toThrow();
		});
	});

	describe('tags / taggables', () => {
		it('creates a tag and a polymorphic taggable join to a pen', () => {
			const f = seedControlledLists();
			const pen = db
				.insert(pens)
				.values({
					brand_id: f.brand.id,
					model_id: f.model.id,
					color: 'Primary Manipulation 5.5',
					material_id: f.penMaterial.id,
					trim_color_id: f.finish.id,
					filling_system_id: f.fillingSystem.id,
					size_category: 'standard',
					condition: 'new',
					ownership_state: 'active'
				})
				.returning()
				.get();
			const tag = db.insert(tags).values({ name: 'daily carry' }).returning().get();
			db.insert(taggables)
				.values({ tag_id: tag.id, taggable_type: 'pen', taggable_id: pen.id })
				.run();

			const joined = db
				.select()
				.from(taggables)
				.where(
					and(
						eq(taggables.tag_id, tag.id),
						eq(taggables.taggable_type, 'pen'),
						eq(taggables.taggable_id, pen.id)
					)
				)
				.get();
			expect(joined).toBeDefined();
		});

		it('enforces the tag_id foreign key', () => {
			expect(() =>
				db.insert(taggables).values({ tag_id: 999999, taggable_type: 'pen', taggable_id: 1 }).run()
			).toThrow();
		});

		it('does not constrain taggable_id at the database level — polymorphic, application-layer only', () => {
			const tag = db.insert(tags).values({ name: 'daily carry' }).returning().get();
			expect(() =>
				db
					.insert(taggables)
					.values({ tag_id: tag.id, taggable_type: 'pen', taggable_id: 999999 })
					.run()
			).not.toThrow();
		});
	});
});
