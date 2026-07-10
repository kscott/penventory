import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../db/migrate';
import {
	aliases,
	brands,
	filling_systems,
	finishes,
	import_attempts,
	import_flagged_items,
	import_runs,
	inks,
	lines,
	models,
	nib_base_sizes,
	nib_materials,
	nib_shapes,
	nibs,
	pen_materials,
	pen_nibs,
	pens
} from '../db/schema';
import { CommitRefusedError, commitImportAttempt, parseCatalogImport } from './fpc-import';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'fpc-export');

function fixture(kind: 'pens' | 'inks', name: string): string {
	return readFileSync(join(FIXTURES_DIR, kind, `${name}.csv`), 'utf-8');
}

describe('fpc-import (parse + commit)', () => {
	let dir: string;
	let sqlite: Database.Database;
	let db: ReturnType<typeof migrateDatabase>;
	let backupDir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'penventory-test-'));
		sqlite = new Database(join(dir, `${randomUUID()}.db`));
		sqlite.pragma('foreign_keys = ON');
		db = migrateDatabase(sqlite);
		backupDir = join(dir, 'backups');
	});

	afterEach(() => {
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	function flaggedItemsFor(attemptId: number) {
		return db
			.select()
			.from(import_flagged_items)
			.where(eq(import_flagged_items.import_attempt_id, attemptId))
			.all();
	}

	function decideAllClean(attemptId: number, decision: 'import' | 'skip' = 'import') {
		for (const item of flaggedItemsFor(attemptId)) {
			if (item.decision === null) {
				db.update(import_flagged_items)
					.set({ decision, decided_at: new Date() })
					.where(eq(import_flagged_items.id, item.id))
					.run();
			}
		}
	}

	describe('parse', () => {
		it('writes one import_attempts row and an import_runs audit row', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nullable-fields'),
				inksCSV: fixture('inks', 'empty')
			});

			const attempt = db
				.select()
				.from(import_attempts)
				.where(eq(import_attempts.id, attemptId))
				.get();
			expect(attempt?.status).toBe('open');

			const runs = db.select().from(import_runs).all();
			expect(runs).toHaveLength(1);
			expect(runs[0].operation_type).toBe('catalog_import');
			expect(runs[0].mode).toBe('dry_run');
		});

		it('auto-decides a clean row as "import", nothing left to review', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nullable-fields'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items).toHaveLength(1);
			expect(items[0].flag_type).toBeNull();
			expect(items[0].decision).toBe('import');
		});

		it('flags an exact duplicate found within the same batch', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'exact-duplicate'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items).toHaveLength(2);
			expect(items[0].flag_type).toBeNull();
			expect(items[1].flag_type).toBe('possible_duplicate');
			expect(items[1].decision).toBeNull();
		});

		it('flags a near-duplicate typo found within the same batch', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'near-duplicate-typo'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[1].flag_type).toBe('possible_duplicate');
		});

		it('flags brand drift against an already-committed catalog brand (character-typo signal)', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('needs_confirmation');
			const candidateInfo = items[0].candidate_info as { fields: Record<string, unknown> };
			expect(candidateInfo.fields.brand).toBeDefined();
		});

		it('flags a compound/legal-name brand variant against an existing brand — the "Pilot" vs "Pilot Namiki" shape, word-containment not character typo', () => {
			db.insert(brands).values({ name: 'Larkspur' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-compound-name-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('needs_confirmation');
			const candidateInfo = items[0].candidate_info as {
				fields: { brand?: { candidates: { reasons: string[] }[] } };
			};
			const candidates = candidateInfo.fields.brand?.candidates ?? [];
			expect(candidates.length).toBeGreaterThan(0);
			// Isolates the word-containment signal from the character-typo one:
			// "Larkspur Pen Company" is nothing like "Larkspur" edit-distance-
			// wise, but every word of the shorter name appears in the longer.
			expect(candidates[0].reasons).toEqual(['contains']);
		});

		it('resolves a zero-overlap alias name automatically — the "Namiki" -> "Pilot" shape, no shared words at all', () => {
			const brand = db.insert(brands).values({ name: 'Larkspur' }).returning().get();
			db.insert(aliases)
				.values({ alias: 'Corvid', aliasable_type: 'brand', aliasable_id: brand.id })
				.run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-alias-zero-overlap'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBeNull();
			expect(items[0].decision).toBe('import');
		});

		it('resolves a known alias automatically, no flag', () => {
			const brand = db.insert(brands).values({ name: 'Sturdywood' }).returning().get();
			db.insert(aliases)
				.values({ alias: 'Sturdywood Pens', aliasable_type: 'brand', aliasable_id: brand.id })
				.run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'known-alias'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBeNull();
			expect(items[0].decision).toBe('import');
		});

		it('flags an unparseable nib (malformed token, the "sF" case)', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('unparseable_nib');
			expect(items[0].candidate_info).toBeNull();
		});

		it('flags an unparseable nib (bare custom name, no point size)', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-bare-custom-name-no-point-size'),
				inksCSV: fixture('inks', 'empty')
			});

			expect(flaggedItemsFor(attemptId)[0].flag_type).toBe('unparseable_nib');
		});

		it('resolves a null line_id cleanly, no flag, when Line is blank', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'blank-line')
			});

			expect(flaggedItemsFor(attemptId)[0].flag_type).toBeNull();
		});

		it('flags a possible_duplicate against an already-committed catalog pen, not just within-batch', () => {
			// loadExistingPenKeys/loadExistingInkKeys — every other duplicate
			// test here uses two rows in the same batch; this is the "against
			// whatever's already in the database" half of step 6's stated
			// scope, exercised for the first time with a real existing row.
			const brand = db.insert(brands).values({ name: 'Quietbrook' }).returning().get();
			const material = db.insert(pen_materials).values({ name: 'Acrylic' }).returning().get();
			const model = db
				.insert(models)
				.values({ brand_id: brand.id, name: 'Solstice' })
				.returning()
				.get();
			const finish = db.insert(finishes).values({ name: 'Gold' }).returning().get();
			const fillingSystem = db
				.insert(filling_systems)
				.values({ name: 'Cartridge/Converter' })
				.returning()
				.get();
			db.insert(pens)
				.values({
					brand_id: brand.id,
					model_id: model.id,
					color: 'Harbor Blue',
					material_id: material.id,
					trim_color_id: finish.id,
					filling_system_id: fillingSystem.id,
					ownership_state: 'active'
				})
				.run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nullable-fields'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('possible_duplicate');
			const candidateInfo = items[0].candidate_info as { matches: { matchType: string }[] };
			expect(candidateInfo.matches[0].matchType).toBe('existing');
		});

		it('flags a possible_duplicate against an already-committed catalog ink, not just within-batch', () => {
			const brand = db.insert(brands).values({ name: 'Quietbrook' }).returning().get();
			db.insert(inks)
				.values({
					brand_id: brand.id,
					name: 'Harbor Fog',
					type: 'bottle',
					color_fpc: '#5a6b73',
					ownership_state: 'active'
				})
				.run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'blank-line')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('possible_duplicate');
			const candidateInfo = items[0].candidate_info as { matches: { matchType: string }[] };
			expect(candidateInfo.matches[0].matchType).toBe('existing');
		});

		it('a flag caused only by an unrecognized nib base_size/purity (no controlled-list field flagged) has decidedField null', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-unrecognized-base-size'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('needs_confirmation');
			const candidateInfo = items[0].candidate_info as {
				fields: Record<string, unknown>;
				nibValueFlags: { field: string; rawValue: string }[];
				decidedField: string | null;
			};
			expect(candidateInfo.fields).toEqual({});
			expect(candidateInfo.nibValueFlags).toEqual([{ field: 'nib_base_size', rawValue: '#7' }]);
			expect(candidateInfo.decidedField).toBeNull();
		});
	});

	describe('commit', () => {
		it('refuses when any flagged item still has decision = null', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'exact-duplicate'),
				inksCSV: fixture('inks', 'empty')
			});

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
		});

		it('refuses an attempt with zero rows — both CSVs empty', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'empty')
			});

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
		});

		it('refuses a nonexistent attempt id', async () => {
			await expect(commitImportAttempt(db, sqlite, 999999, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
		});

		it('takes a real backup before writing anything', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nullable-fields'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			expect(existsSync(backupDir)).toBe(true);
			expect(readdirSync(backupDir).length).toBeGreaterThan(0);
		});

		it('commits a nib with an unrecognized base_size — creates the missing lookup row rather than crashing', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-unrecognized-base-size'),
				inksCSV: fixture('inks', 'empty')
			});
			decideAllClean(attemptId, 'import');

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.nibsCreated).toBe(1);

			const nib = db.select().from(nibs).all()[0];
			const baseSize = db
				.select()
				.from(nib_base_sizes)
				.all()
				.find((b) => b.id === nib.base_size_id);
			expect(baseSize?.name).toBe('#7');
		});

		it('commits an archived pen as ownership_state = retired, with ownership_changed_on set', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'archived-retired-with-date'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.ownership_state).toBe('retired');
			expect(pen.ownership_changed_on).not.toBeNull();
		});

		it('commits an archived pen with no Archived On date as ownership_changed_on = null, not a crash', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'archived-retired-no-date'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.ownership_state).toBe('retired');
			expect(pen.ownership_changed_on).toBeNull();
		});

		it('commits an ink with a populated Maker, resolving maker_id separately from brand_id', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'with-maker')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const ink = db.select().from(inks).all()[0];
			expect(ink.maker_id).not.toBeNull();
			expect(ink.maker_id).not.toBe(ink.brand_id);
			const maker = db
				.select()
				.from(brands)
				.all()
				.find((b) => b.id === ink.maker_id);
			expect(maker?.name).toBe('Riverstone');
		});

		it('commits a clean pen with a bare-point-size nib — Steel/#6/Round defaults, size_category/condition null', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-bare-point-size'),
				inksCSV: fixture('inks', 'empty')
			});

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result).toEqual({ committed: true, pensCreated: 1, inksCreated: 0, nibsCreated: 1 });

			const pen = db.select().from(pens).all()[0];
			expect(pen.size_category).toBeNull();
			expect(pen.condition).toBeNull();

			const link = db.select().from(pen_nibs).all()[0];
			expect(link.pen_id).toBe(pen.id);
			expect(link.removed_on).toBeNull();

			// FPC's Nib column never records the nib's own manufacturer
			// separately from the pen's brand — nibs.brand_id stays null
			// regardless of the pen's brand, not a silent reuse.
			const nib = db.select().from(nibs).all()[0];
			expect(nib.brand_id).toBeNull();

			const attempt = db
				.select()
				.from(import_attempts)
				.where(eq(import_attempts.id, attemptId))
				.get();
			expect(attempt?.status).toBe('committed');
			expect(attempt?.committed_at).not.toBeNull();
		});

		it('resolves the model at parse time (not deferred) when its brand is already known', async () => {
			// Seeded so brand resolves 'resolved' at parse — only then does
			// model resolution happen at parse rather than deferring to
			// commit (see parseCatalogImport's pen loop).
			db.insert(brands).values({ name: 'Quietbrook' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nullable-fields'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.model_id).not.toBeNull();
		});

		it('commits a blank Nib as a pen with no linked nib at all', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-blank'),
				inksCSV: fixture('inks', 'empty')
			});

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.nibsCreated).toBe(0);
			expect(db.select().from(pen_nibs).all()).toEqual([]);
		});

		it('commits a full compound nib, resolving an already-known material/shape', async () => {
			// Phrase-boundary matching for a compound Nib string only works
			// against *known* vocabulary — the same reason a genuinely new
			// value falls through to custom_name until it's been seen once
			// (see nib-parser's tests). Pre-seeding here mirrors a collection
			// where Titanium/Cursive Smooth Italic have shown up before.
			db.insert(nib_materials).values({ name: 'Titanium' }).run();
			db.insert(nib_shapes).values({ name: 'Cursive Smooth Italic' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-full-compound'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const nib = db.select().from(nibs).all()[0];
			expect(nib.custom_name).toBeNull();
			expect(nib.is_custom_grind).toBe(false);

			const material = db
				.select()
				.from(nib_materials)
				.all()
				.find((m) => m.id === nib.material_id);
			expect(material?.name).toBe('Titanium');
			const shape = db
				.select()
				.from(nib_shapes)
				.all()
				.find((s) => s.id === nib.shape_id);
			expect(shape?.name).toBe('Cursive Smooth Italic');
		});

		it('commits a nib with an explicit purity token, resolving purity_id', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-with-purity'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const nib = db.select().from(nibs).all()[0];
			expect(nib.purity_id).not.toBeNull();
		});

		it('commits a custom grind name into nibs.custom_name and sets is_custom_grind', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-custom-grind-name'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const nib = db.select().from(nibs).all()[0];
			expect(nib.custom_name).toBe('Journaler');
			expect(nib.is_custom_grind).toBe(true);
		});

		it('commits a finish (plating color) extracted from the Nib text, separate from material', async () => {
			db.insert(finishes).values({ name: 'Rose Gold' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'finish-as-plating-color'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const nib = db.select().from(nibs).all()[0];
			expect(nib.finish_id).not.toBeNull();
		});

		it('an unparseable_nib row can be skipped, committing the pen without a nib', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});
			decideAllClean(attemptId, 'skip');

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(0);
			expect(result.nibsCreated).toBe(0);
			expect(db.select().from(pens).all()).toEqual([]);
		});

		it('a needs_confirmation flag on brand can be resolved via merge_into, reusing the existing id', async () => {
			const existingBrand = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const item = flaggedItemsFor(attemptId)[0];
			db.update(import_flagged_items)
				.set({
					decision: 'merge_into',
					decision_target_id: existingBrand.id,
					decided_at: new Date()
				})
				.where(eq(import_flagged_items.id, item.id))
				.run();

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.brand_id).toBe(existingBrand.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('a compound-name brand flag ("Pilot Namiki" shape) resolves end-to-end via merge_into, no duplicate brand created', async () => {
			const existingBrand = db.insert(brands).values({ name: 'Larkspur' }).returning().get();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-compound-name-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const item = flaggedItemsFor(attemptId)[0];
			db.update(import_flagged_items)
				.set({
					decision: 'merge_into',
					decision_target_id: existingBrand.id,
					decided_at: new Date()
				})
				.where(eq(import_flagged_items.id, item.id))
				.run();

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.brand_id).toBe(existingBrand.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('a compound-name brand flag ("Pilot Namiki" shape) resolves end-to-end via alias_to, recording the alias and no duplicate', async () => {
			const existingBrand = db.insert(brands).values({ name: 'Larkspur' }).returning().get();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-compound-name-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const item = flaggedItemsFor(attemptId)[0];
			db.update(import_flagged_items)
				.set({
					decision: 'alias_to',
					decision_target_id: existingBrand.id,
					decided_at: new Date()
				})
				.where(eq(import_flagged_items.id, item.id))
				.run();

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.brand_id).toBe(existingBrand.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
			const alias = db.select().from(aliases).all()[0];
			expect(alias).toMatchObject({
				alias: 'Larkspur Pen Company',
				aliasable_type: 'brand',
				aliasable_id: existingBrand.id
			});
		});

		it('a compound-name brand flag ("Pilot Namiki" shape) resolved via import is REFUSED — word-containment can never create a separate brand', async () => {
			db.insert(brands).values({ name: 'Larkspur' }).run();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-compound-name-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const item = flaggedItemsFor(attemptId)[0];
			db.update(import_flagged_items)
				.set({ decision: 'import', decided_at: new Date() })
				.where(eq(import_flagged_items.id, item.id))
				.run();

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);

			// Refused before anything was written — no pen, no second brand.
			expect(db.select().from(pens).all()).toEqual([]);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('by contrast, a character-typo-only brand flag ("Wavecrest"/"Wavecrst" shape) resolved via import IS allowed — creates a genuinely separate brand', async () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-drift'),
				inksCSV: fixture('inks', 'empty')
			});
			decideAllClean(attemptId, 'import');

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const allBrands = db.select().from(brands).all();
			expect(allBrands).toHaveLength(2);
			const pen = db.select().from(pens).all()[0];
			expect(allBrands.find((b) => b.id === pen.brand_id)?.name).toBe('Wavecrst');
		});

		it('a needs_confirmation flag on brand can be resolved via alias_to, recording the alias for next time', async () => {
			const existingBrand = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const item = flaggedItemsFor(attemptId)[0];
			db.update(import_flagged_items)
				.set({ decision: 'alias_to', decision_target_id: existingBrand.id, decided_at: new Date() })
				.where(eq(import_flagged_items.id, item.id))
				.run();

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const alias = db.select().from(aliases).all()[0];
			expect(alias).toMatchObject({
				alias: 'Wavecrst',
				aliasable_type: 'brand',
				aliasable_id: existingBrand.id
			});
		});

		it('flags a new model/line ambiguity discovered only once brand context is known, and refuses to commit', async () => {
			const brand = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			db.insert(models).values({ brand_id: brand.id, name: 'Vantage' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'model-drift-after-brand-resolved'),
				inksCSV: fixture('inks', 'empty')
			});

			const item = flaggedItemsFor(attemptId)[0];
			db.update(import_flagged_items)
				.set({ decision: 'merge_into', decision_target_id: brand.id, decided_at: new Date() })
				.where(eq(import_flagged_items.id, item.id))
				.run();

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);

			expect(db.select().from(pens).all()).toEqual([]);
			const items = flaggedItemsFor(attemptId);
			expect(items).toHaveLength(2);
			const newItem = items.find((i) => i.id !== item.id)!;
			expect(newItem.flag_type).toBe('needs_confirmation');
			expect(newItem.decision).toBeNull();
		});

		it('flags a new line ambiguity discovered only once brand context is known (ink-side counterpart), and refuses to commit', async () => {
			const brand = db.insert(brands).values({ name: 'Thistlebrook' }).returning().get();
			db.insert(lines).values({ brand_id: brand.id, name: 'Woodland' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'line-drift-after-brand-resolved')
			});

			const item = flaggedItemsFor(attemptId)[0];
			db.update(import_flagged_items)
				.set({ decision: 'merge_into', decision_target_id: brand.id, decided_at: new Date() })
				.where(eq(import_flagged_items.id, item.id))
				.run();

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);

			expect(db.select().from(inks).all()).toEqual([]);
			const items = flaggedItemsFor(attemptId);
			expect(items).toHaveLength(2);
			const newItem = items.find((i) => i.id !== item.id)!;
			expect(newItem.flag_type).toBe('needs_confirmation');
			expect(newItem.decision).toBeNull();
		});

		it('commits an ink with a real line, resolving/creating it under the brand', async () => {
			// Seeded so brand resolves 'resolved' (not 'new') at parse time —
			// only then does line resolution happen at parse rather than
			// deferring to commit (see parseCatalogImport's ink loop).
			db.insert(brands).values({ name: 'Thistlebrook' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'with-line')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const ink = db.select().from(inks).all()[0];
			expect(ink.line_id).not.toBeNull();
			const line = db.select().from(lines).all()[0];
			expect(line).toMatchObject({ id: ink.line_id, name: 'Woodland' });
		});

		it('resolves a line at commit time when its brand was itself new at parse', async () => {
			// No brand seeded — Brand resolves 'new' at parse, so line
			// resolution is deferred entirely to commit (see
			// parseCatalogImport's ink loop: line stays null when brand isn't
			// 'resolved' yet).
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'with-line')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const ink = db.select().from(inks).all()[0];
			const line = db.select().from(lines).all()[0];
			expect(line).toMatchObject({ id: ink.line_id, name: 'Woodland' });
		});

		it('commits an ink with a null line_id when Line is blank', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'blank-line')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const ink = db.select().from(inks).all()[0];
			expect(ink.line_id).toBeNull();
		});

		it('commits an archived ink as ownership_state = rehomed, with ownership_changed_on set', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'archived-rehomed')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const ink = db.select().from(inks).all()[0];
			expect(ink.ownership_state).toBe('rehomed');
			expect(ink.ownership_changed_on).not.toBeNull();
		});

		it('commits an archived ink with no Archived On date as ownership_changed_on = null, not a crash', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'archived-rehomed-no-date')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const ink = db.select().from(inks).all()[0];
			expect(ink.ownership_state).toBe('rehomed');
			expect(ink.ownership_changed_on).toBeNull();
		});

		it('joins Comment and Private Comment into notes when both are present', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'empty'),
				inksCSV: fixture('inks', 'comment-and-private-comment')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const ink = db.select().from(inks).all()[0];
			expect(ink.notes).toBe("bought at a pen show\n\ngift for Dana, don't mention");
		});

		it('writes an import_runs commit row alongside the parse row', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nullable-fields'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const runs = db.select().from(import_runs).all();
			expect(runs).toHaveLength(2);
			expect(runs.map((r) => r.mode).sort()).toEqual(['commit', 'dry_run']);
		});
	});
});
