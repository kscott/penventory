import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from './migrate';
import { create, getById, listAll } from './repository';
import {
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
	pen_materials,
	pen_nibs,
	pens,
	tags,
	vendors
} from './schema';

describe('repository (create / getById / listAll)', () => {
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

	function seedControlledLists() {
		const brand = create(db, brands, { name: 'Pilot' });
		const model = create(db, models, { brand_id: brand.id, name: 'Custom 823' });
		const line = create(db, lines, { brand_id: brand.id, name: 'Iroshizuku' });
		const penMaterial = create(db, pen_materials, { name: 'Acrylic' });
		const finish = create(db, finishes, { name: 'Rhodium' });
		const fillingSystem = create(db, filling_systems, { name: 'Piston' });
		// Gold/Round are pre-seeded by migration now — select rather than
		// create, same pattern as purity/baseSize/pointSize below.
		const nibMaterial = db
			.select()
			.from(nib_materials)
			.where(eq(nib_materials.name, 'Gold'))
			.get()!;
		const nibShape = db.select().from(nib_shapes).where(eq(nib_shapes.name, 'Round')).get()!;
		const vendor = create(db, vendors, { name: 'PenRealm' });
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

	it('creates, gets by id, and lists a pen', () => {
		const f = seedControlledLists();
		const pen = create(db, pens, {
			brand_id: f.brand.id,
			model_id: f.model.id,
			color: 'Primary Manipulation 5.5',
			material_id: f.penMaterial.id,
			trim_color_id: f.finish.id,
			filling_system_id: f.fillingSystem.id,
			size_category: 'standard',
			condition: 'new',
			ownership_state: 'active'
		});

		expect(getById(db, pens, pen.id)).toEqual(pen);
		expect(listAll(db, pens)).toEqual([pen]);
	});

	it('creates, gets by id, and lists an ink', () => {
		const f = seedControlledLists();
		const ink = create(db, inks, {
			brand_id: f.brand.id,
			line_id: f.line.id,
			name: 'Kon-peki',
			type: 'bottle',
			color_fpc: '#123456',
			ownership_state: 'active'
		});

		expect(getById(db, inks, ink.id)).toEqual(ink);
		expect(listAll(db, inks)).toEqual([ink]);
	});

	it('creates, gets by id, and lists a nib', () => {
		const f = seedControlledLists();
		const nib = create(db, nibs, {
			brand_id: f.brand.id,
			material_id: f.nibMaterial.id,
			purity_id: f.purity.id,
			base_size_id: f.baseSize.id,
			point_size_id: f.pointSize.id,
			shape_id: f.nibShape.id,
			finish_id: f.finish.id,
			nibmeister_id: f.vendor.id
		});

		expect(getById(db, nibs, nib.id)).toEqual(nib);
		expect(listAll(db, nibs)).toEqual([nib]);
	});

	describe('pen_nibs', () => {
		function seedPenAndNib(f: ReturnType<typeof seedControlledLists>) {
			const pen = create(db, pens, {
				brand_id: f.brand.id,
				model_id: f.model.id,
				color: 'Primary Manipulation 5.5',
				material_id: f.penMaterial.id,
				trim_color_id: f.finish.id,
				filling_system_id: f.fillingSystem.id,
				size_category: 'standard',
				condition: 'new',
				ownership_state: 'active'
			});
			const nib = create(db, nibs, {
				material_id: f.nibMaterial.id,
				base_size_id: f.baseSize.id,
				point_size_id: f.pointSize.id,
				shape_id: f.nibShape.id
			});
			return { pen, nib };
		}

		it('accepts a null removed_on — currently installed', () => {
			const f = seedControlledLists();
			const { pen, nib } = seedPenAndNib(f);
			const link = create(db, pen_nibs, {
				pen_id: pen.id,
				nib_id: nib.id,
				installed_on: new Date('2024-01-01')
			});

			expect(link.removed_on).toBeNull();
			expect(getById(db, pen_nibs, link.id)).toEqual(link);
			expect(listAll(db, pen_nibs)).toEqual([link]);
		});

		it('accepts a closed removed_on — a completed install record', () => {
			const f = seedControlledLists();
			const { pen, nib } = seedPenAndNib(f);
			const link = create(db, pen_nibs, {
				pen_id: pen.id,
				nib_id: nib.id,
				installed_on: new Date('2024-01-01'),
				removed_on: new Date('2024-06-01')
			});

			expect(link.removed_on).toEqual(new Date('2024-06-01'));
		});

		it('enforces the pen_id and nib_id foreign keys', () => {
			const f = seedControlledLists();
			const { pen, nib } = seedPenAndNib(f);

			expect(() =>
				db
					.insert(pen_nibs)
					.values({ pen_id: 999999, nib_id: nib.id, installed_on: new Date() })
					.run()
			).toThrow();
			expect(() =>
				db
					.insert(pen_nibs)
					.values({ pen_id: pen.id, nib_id: 999999, installed_on: new Date() })
					.run()
			).toThrow();
		});
	});

	it('getById returns undefined for a nonexistent row', () => {
		expect(getById(db, pens, 999999)).toBeUndefined();
	});

	it('listAll returns an empty array when there are no rows', () => {
		expect(listAll(db, tags)).toEqual([]);
	});
});
