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

	// Seeds a fully-resolved existing catalog pen — used by tests proving
	// duplicate detection interacts correctly with other signals (brand
	// ambiguity, unparseable nib) on the incoming row.
	function seedExistingPen(
		targetDb: typeof db,
		fields: {
			brand: string;
			model: string;
			color: string;
			material: string;
			trimColor: string;
			fillingSystem: string;
		}
	) {
		const brand = targetDb.insert(brands).values({ name: fields.brand }).returning().get();
		const material = targetDb
			.insert(pen_materials)
			.values({ name: fields.material })
			.returning()
			.get();
		const model = targetDb
			.insert(models)
			.values({ brand_id: brand.id, name: fields.model })
			.returning()
			.get();
		const finish = targetDb.insert(finishes).values({ name: fields.trimColor }).returning().get();
		const fillingSystem = targetDb
			.insert(filling_systems)
			.values({ name: fields.fillingSystem })
			.returning()
			.get();
		targetDb
			.insert(pens)
			.values({
				brand_id: brand.id,
				model_id: model.id,
				color: fields.color,
				material_id: material.id,
				trim_color_id: finish.id,
				filling_system_id: fillingSystem.id,
				ownership_state: 'active'
			})
			.run();
	}

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

	// Sets a single field's decision on a needs_confirmation item — every
	// ambiguous field is independently decided via field_decisions, not the
	// row-level decision/decision_target_id columns (see decision-
	// resolution.ts and docs/adr/2026-07-10-per-field-decisions-not-per-row.md).
	function decideField(
		itemId: number,
		field: string,
		decision: 'import' | 'merge_into' | 'alias_to',
		decisionTargetId: number | null = null
	) {
		const item = db
			.select()
			.from(import_flagged_items)
			.where(eq(import_flagged_items.id, itemId))
			.get()!;
		const existing = item.field_decisions ?? {};
		db.update(import_flagged_items)
			.set({
				field_decisions: { ...existing, [field]: { decision, decisionTargetId } },
				decided_at: new Date()
			})
			.where(eq(import_flagged_items.id, itemId))
			.run();
	}

	// Row-level decision for unparseable_row/unparseable_nib — 'import' means
	// "row_data.raw has been corrected, re-resolve it now." Accepts the full
	// ImportDecision type (not just import/skip) so tests can prove the
	// defensive guard against a nonsensical value (e.g. merge_into, which
	// makes no sense for a whole-row/whole-nib correction).
	function decideRow(itemId: number, decision: 'import' | 'skip' | 'merge_into' | 'alias_to') {
		db.update(import_flagged_items)
			.set({ decision, decided_at: new Date() })
			.where(eq(import_flagged_items.id, itemId))
			.run();
	}

	// Stands in for Phase 1.1's review UI editing a flagged row's raw data
	// directly before choosing 'import' — mutates the stored row_data.raw
	// snapshot in place.
	function correctRawField(itemId: number, field: string, value: string) {
		const item = db
			.select()
			.from(import_flagged_items)
			.where(eq(import_flagged_items.id, itemId))
			.get()!;
		const rowData = item.row_data as { raw: Record<string, string> };
		rowData.raw[field] = value;
		db.update(import_flagged_items)
			.set({ row_data: rowData })
			.where(eq(import_flagged_items.id, itemId))
			.run();
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
			expect(items[0].candidate_info).toEqual({
				unparseableNibReason: 'no point size found anywhere in the text',
				fields: {},
				nibValueFlags: []
			});
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

		it('resolves a null trim_color_id cleanly, no flag, when Trim Color is blank — real case, no trim hardware', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'blank-trim-color'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBeNull();
			const rowData = items[0].row_data as { trimColor: unknown };
			expect(rowData.trimColor).toBeNull();
		});

		it('flags Filling System drift against an existing controlled-list value — confirmed real drift pattern ("Cartridge/Converter" vs "Carterdge/Converter")', () => {
			db.insert(filling_systems).values({ name: 'Cartridge/Converter' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'filling-system-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('needs_confirmation');
			const candidateInfo = items[0].candidate_info as { fields: Record<string, unknown> };
			expect(candidateInfo.fields.filling_system).toBeDefined();
		});

		it('flags Trim Color drift against an existing controlled-list value', () => {
			db.insert(finishes).values({ name: 'Rhodium' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'trim-color-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('needs_confirmation');
			const candidateInfo = items[0].candidate_info as { fields: Record<string, unknown> };
			expect(candidateInfo.fields.trim_color).toBeDefined();
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

		it('a flag caused only by an unrecognized nib base_size/purity (no controlled-list field flagged) still requires its own field_decisions entry', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-unrecognized-base-size'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('needs_confirmation');
			const candidateInfo = items[0].candidate_info as {
				fields: Record<string, unknown>;
				nibValueFlags: { field: string; rawValue: string }[];
			};
			expect(candidateInfo.fields).toEqual({});
			expect(candidateInfo.nibValueFlags).toEqual([{ field: 'nib_base_size', rawValue: '#7' }]);
			expect(items[0].field_decisions).toBeNull();
		});

		it('flags a blank required field (Brand) as unparseable_row, skipping resolution entirely', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'blank-brand'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('unparseable_row');
			expect(items[0].candidate_info).toEqual({ missingFields: ['Brand'] });
			const rowData = items[0].row_data as { entityType: string; missingFields: string[] };
			expect(rowData.entityType).toBe('unparseable_row');
			expect(rowData.missingFields).toEqual(['Brand']);
			// No brand was ever created for this row — resolution was never
			// attempted, not just discarded.
			expect(db.select().from(brands).all()).toEqual([]);
		});

		it('flags two genuinely independent fields ambiguous on the same row (Brand typo AND Material typo)', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			db.insert(pen_materials).values({ name: 'Acrylic' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'multi-field-typo'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('needs_confirmation');
			const candidateInfo = items[0].candidate_info as { fields: Record<string, unknown> };
			expect(Object.keys(candidateInfo.fields).sort()).toEqual(['brand', 'pen_material']);
		});

		it('a row that is both a possible_duplicate AND has an ambiguous Brand preserves both signals, not just the duplicate one', () => {
			// Real scenario: composite-key duplicate detection runs on raw text,
			// independent of resolveOrFlag — a row can simultaneously look like a
			// near-dupe of an existing pen (Model/Color/Material/Trim all match)
			// AND have a Brand value that's itself a typo needing its own
			// decision. Confirmed bug (2026-07-10): determineFlag's if/else chain
			// picked possible_duplicate and silently discarded the brand
			// ambiguity — candidate_info had no `fields` key at all, so there was
			// no way to even decide the brand in the review UI; commit would
			// throw a confusing "still ambiguous, no recorded decision" error
			// with nothing pointing back to what needed deciding.
			seedExistingPen(db, {
				brand: 'Wavecrest',
				model: 'Drifter',
				color: 'Slate',
				material: 'Resin',
				trimColor: 'Silver',
				fillingSystem: 'Piston Filler'
			});

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId);
			expect(items[0].flag_type).toBe('possible_duplicate');
			const candidateInfo = items[0].candidate_info as {
				matches: { matchType: string }[];
				fields: Record<string, unknown>;
			};
			expect(candidateInfo.matches.length).toBeGreaterThan(0);
			expect(candidateInfo.fields.brand).toBeDefined();
		});

		it('tracks the source CSV line number on every row, 1-indexed including the header', () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'exact-duplicate'),
				inksCSV: fixture('inks', 'empty')
			});

			const items = flaggedItemsFor(attemptId).sort((a, b) => a.id - b.id);
			const sourceLines = items.map((item) => (item.row_data as { sourceLine: number }).sourceLine);
			expect(sourceLines).toEqual([2, 3]);
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
			const item = flaggedItemsFor(attemptId)[0];
			decideField(item.id, 'nib_base_size', 'import');

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

		it('a possible_duplicate row whose Nib is also unparseable refuses on import rather than silently committing without a nib — confirmed bug, 2026-07-10', async () => {
			// Composite-key duplicate detection deliberately excludes Nib (see
			// penCompositeKey), so a row can be an exact duplicate on every other
			// field while its Nib text is independently malformed. Before the
			// fix, determineFlag picked possible_duplicate and never re-checked
			// the nib at commit (gated on flag_type === 'unparseable_nib', which
			// this row never had) — deciding 'import' silently created the pen
			// with zero nibs, no error, no re-flag. The nib data was just gone.
			seedExistingPen(db, {
				brand: 'Marrowgate',
				model: 'Ledger',
				color: 'Ink Black',
				material: 'Ebonite',
				trimColor: 'Ruthenium',
				fillingSystem: 'Vacuum Filler'
			});

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});
			expect(flaggedItemsFor(attemptId)[0].flag_type).toBe('possible_duplicate');
			decideRow(flaggedItemsFor(attemptId)[0].id, 'import');

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				/still unparseable/
			);
			// The seeded existing pen is still there (untouched) — only the new
			// import row failed to commit, and it failed loudly rather than
			// silently landing without a nib.
			expect(db.select().from(pens).all()).toHaveLength(1);
			expect(db.select().from(nibs).all()).toEqual([]);
		});

		it('a possible_duplicate row whose Nib is also unparseable can be corrected via row_data.raw.Nib, then imports cleanly with the nib intact', async () => {
			seedExistingPen(db, {
				brand: 'Marrowgate',
				model: 'Ledger',
				color: 'Ink Black',
				material: 'Ebonite',
				trimColor: 'Ruthenium',
				fillingSystem: 'Vacuum Filler'
			});

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			correctRawField(item.id, 'Nib', 'F');
			decideRow(item.id, 'import');

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(1);
			expect(result.nibsCreated).toBe(1);
		});

		it('a needs_confirmation flag on brand can be resolved via merge_into, reusing the existing id', async () => {
			const existingBrand = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			const item = flaggedItemsFor(attemptId)[0];
			decideField(item.id, 'brand', 'merge_into', existingBrand.id);

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
			decideField(item.id, 'brand', 'merge_into', existingBrand.id);

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
			decideField(item.id, 'brand', 'alias_to', existingBrand.id);

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
			decideField(item.id, 'brand', 'import');

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
			const item = flaggedItemsFor(attemptId)[0];
			decideField(item.id, 'brand', 'import');

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
			decideField(item.id, 'brand', 'alias_to', existingBrand.id);

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
			decideField(item.id, 'brand', 'merge_into', brand.id);

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
			decideField(item.id, 'brand', 'merge_into', brand.id);

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

		it('an unparseable_row can be skipped outright — nothing created, no correction attempted', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'blank-brand'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideRow(item.id, 'skip');

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(0);
			expect(db.select().from(pens).all()).toEqual([]);
			expect(db.select().from(brands).all()).toEqual([]);
		});

		it('an unparseable_row decided "import" without correction refuses again — still missing the same field', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'blank-brand'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideRow(item.id, 'import');

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
			expect(db.select().from(pens).all()).toEqual([]);
		});

		it('an unparseable_row, corrected via row_data.raw and decided "import", resolves and commits cleanly', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'blank-brand'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			correctRawField(item.id, 'Brand', 'Fernhollow');
			decideRow(item.id, 'import');

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(1);

			const pen = db.select().from(pens).all()[0];
			const brand = db
				.select()
				.from(brands)
				.all()
				.find((b) => b.id === pen.brand_id);
			expect(brand?.name).toBe('Fernhollow');
		});

		it('an unparseable_row, corrected to a value that is itself now ambiguous, gets re-flagged rather than committed blind', async () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'blank-brand'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			correctRawField(item.id, 'Brand', 'Wavecrst'); // typo of the seeded brand
			decideRow(item.id, 'import');

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

		it('an unparseable_nib, corrected via row_data.raw.Nib and decided "import", resolves and commits cleanly', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			correctRawField(item.id, 'Nib', 'M');
			decideRow(item.id, 'import');

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.nibsCreated).toBe(1);
			expect(db.select().from(pen_nibs).all()).toHaveLength(1);
		});

		it('an unparseable_nib decided "import" without correction refuses again — Nib is still unparseable', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideRow(item.id, 'import');

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
			expect(db.select().from(pens).all()).toEqual([]);
		});

		it('two independently-flagged fields on one row (Brand typo AND Material typo) both resolve correctly in a single commit — the real fix for "only the first field is workable"', async () => {
			const existingBrand = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const existingMaterial = db
				.insert(pen_materials)
				.values({ name: 'Acrylic' })
				.returning()
				.get();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'multi-field-typo'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideField(item.id, 'brand', 'merge_into', existingBrand.id);
			decideField(item.id, 'pen_material', 'merge_into', existingMaterial.id);

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(1);

			const pen = db.select().from(pens).all()[0];
			expect(pen.brand_id).toBe(existingBrand.id);
			expect(pen.material_id).toBe(existingMaterial.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
			expect(db.select().from(pen_materials).all()).toHaveLength(1);
		});

		it('three independently-flagged fields on one row (Brand, Material, Trim Color all typoed) all resolve correctly in a single commit, decided in a different order than parse encountered them', async () => {
			const existingBrand = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const existingMaterial = db
				.insert(pen_materials)
				.values({ name: 'Acrylic' })
				.returning()
				.get();
			const existingFinish = db.insert(finishes).values({ name: 'Rhodium' }).returning().get();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'three-field-typo'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			const candidateInfo = item.candidate_info as { fields: Record<string, unknown> };
			expect(Object.keys(candidateInfo.fields).sort()).toEqual([
				'brand',
				'pen_material',
				'trim_color'
			]);

			// Decided out of parse order (trim_color, then brand, then
			// material) — field_decisions is a map, not a queue, so order of
			// decision shouldn't matter to the outcome.
			decideField(item.id, 'trim_color', 'merge_into', existingFinish.id);
			decideField(item.id, 'brand', 'merge_into', existingBrand.id);
			decideField(item.id, 'pen_material', 'merge_into', existingMaterial.id);

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(1);

			const pen = db.select().from(pens).all()[0];
			expect(pen.brand_id).toBe(existingBrand.id);
			expect(pen.material_id).toBe(existingMaterial.id);
			expect(pen.trim_color_id).toBe(existingFinish.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
			expect(db.select().from(pen_materials).all()).toHaveLength(1);
			expect(db.select().from(finishes).all()).toHaveLength(1);
		});

		it('three independently-flagged fields with only two decided still refuses — per-field completeness holds at 3+ fields, not just 2', async () => {
			const existingBrand = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const existingMaterial = db
				.insert(pen_materials)
				.values({ name: 'Acrylic' })
				.returning()
				.get();
			db.insert(finishes).values({ name: 'Rhodium' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'three-field-typo'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideField(item.id, 'brand', 'merge_into', existingBrand.id);
			decideField(item.id, 'pen_material', 'merge_into', existingMaterial.id);
			// trim_color deliberately left undecided.

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
			expect(db.select().from(pens).all()).toEqual([]);

			// Deciding the third field is what actually unblocks it.
			const existingFinish = db.select().from(finishes).all()[0];
			decideField(item.id, 'trim_color', 'merge_into', existingFinish.id);
			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(1);
		});

		it('a needs_confirmation row that was never decided at all (field_decisions never touched) refuses to commit', async () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'brand-drift'),
				inksCSV: fixture('inks', 'empty')
			});

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
			expect(db.select().from(pens).all()).toEqual([]);
		});

		it('an unrecognized nib base_size decided with anything other than "import" still refuses — there is no candidate to merge/alias into', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-unrecognized-base-size'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideField(item.id, 'nib_base_size', 'merge_into', 999999);

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
			expect(
				db
					.select()
					.from(nib_base_sizes)
					.all()
					.map((b) => b.name)
			).not.toContain('#7');
		});

		it('an unparseable_row decided with anything other than import/skip refuses defensively', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'blank-brand'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideRow(item.id, 'merge_into');

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
		});

		it('an unparseable_nib decided with anything other than import/skip refuses defensively', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideRow(item.id, 'merge_into');

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
		});

		it("an ink-side unparseable_row is refused — correction isn't implemented for inks yet", async () => {
			// Ink-side blank-required-field detection isn't wired into
			// parseCatalogImport yet (pens-first, per the field-by-field
			// review sequencing) — constructed directly to prove the guard
			// exists and fails loudly rather than silently mishandling it
			// once that gap is closed.
			const attempt = db
				.insert(import_attempts)
				.values({ operation_type: 'catalog_import' })
				.returning()
				.get();
			const item = db
				.insert(import_flagged_items)
				.values({
					import_attempt_id: attempt.id,
					row_data: {
						entityType: 'unparseable_row',
						originalEntityType: 'ink',
						raw: { Brand: '' },
						sourceLine: 2,
						missingFields: ['Brand']
					},
					flag_type: 'unparseable_row',
					candidate_info: { missingFields: ['Brand'] },
					decision: null
				})
				.returning()
				.get();
			decideRow(item.id, 'import');

			await expect(commitImportAttempt(db, sqlite, attempt.id, backupDir)).rejects.toThrow(
				CommitRefusedError
			);
		});

		it('correcting Nib to blank means "no nib after all" — commits the pen with no nib, not a re-thrown error', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			correctRawField(item.id, 'Nib', '');
			decideRow(item.id, 'import');

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(1);
			expect(result.nibsCreated).toBe(0);
			expect(db.select().from(pen_nibs).all()).toEqual([]);
		});

		it('correcting Nib to a value with a finish resolves nibFinish during re-resolution too', async () => {
			db.insert(finishes).values({ name: 'Rose Gold' }).run();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			correctRawField(item.id, 'Nib', 'F Rose Gold');
			decideRow(item.id, 'import');

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const nib = db.select().from(nibs).all()[0];
			expect(nib.finish_id).not.toBeNull();
		});

		it('correcting Nib to a bare point size whose default material ("Steel") collides with an existing near-miss typo gets re-flagged, not silently created — closes the same gap as the compound-name brand case, for a default value instead of raw text', async () => {
			// Real, plausible scenario: an earlier import created "Steal" (an
			// uncorrected typo) as a nib_materials row. A later pen's bare
			// point size ("M") defaults to the literal string "Steel" — which
			// now IS ambiguous against the catalog, even though nothing about
			// this specific row's text was ever fuzzy. Also closes the pens
			// field-by-field review's gap #5 (2026-07-10): nib defaults can
			// collide with existing near-miss data, never previously proven.
			db.insert(nib_materials).values({ name: 'Steal' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-malformed-token'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			correctRawField(item.id, 'Nib', 'M');
			decideRow(item.id, 'import');

			await expect(commitImportAttempt(db, sqlite, attemptId, backupDir)).rejects.toThrow(
				CommitRefusedError
			);

			expect(db.select().from(pens).all()).toEqual([]);
			const items = flaggedItemsFor(attemptId);
			expect(items).toHaveLength(2);
			const newItem = items.find((i) => i.id !== item.id)!;
			expect(newItem.flag_type).toBe('needs_confirmation');
			const candidateInfo = newItem.candidate_info as { fields: Record<string, unknown> };
			expect(candidateInfo.fields.nib_material).toBeDefined();
		});

		it('commits a pen with a blank Trim Color as trim_color_id = null — real case, no trim hardware', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'blank-trim-color'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.trim_color_id).toBeNull();
		});

		it('resolves Filling System drift via merge_into, end-to-end through the full pipeline', async () => {
			const existing = db
				.insert(filling_systems)
				.values({ name: 'Cartridge/Converter' })
				.returning()
				.get();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'filling-system-drift'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideField(item.id, 'filling_system', 'merge_into', existing.id);

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.filling_system_id).toBe(existing.id);
			expect(db.select().from(filling_systems).all()).toHaveLength(1);
		});

		it('resolves Trim Color drift via merge_into, end-to-end through the full pipeline', async () => {
			const existing = db.insert(finishes).values({ name: 'Rhodium' }).returning().get();
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'trim-color-drift'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideField(item.id, 'trim_color', 'merge_into', existing.id);

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.trim_color_id).toBe(existing.id);
			expect(db.select().from(finishes).all()).toHaveLength(1);
		});

		it('pen.trim_color_id and nib.finish_id resolve to two distinct, correctly-named rows in the shared finishes table', async () => {
			// 'Rose Gold' must be known vocabulary for nib-parser's exact-phrase
			// extraction to find it in the Nib text at all — same reason the
			// full-compound-nib test pre-seeds Titanium/Cursive Smooth Italic.
			db.insert(finishes).values({ name: 'Rose Gold' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'finish-as-plating-color'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			const nib = db.select().from(nibs).all()[0];
			expect(pen.trim_color_id).not.toBe(nib.finish_id);
			const allFinishes = db.select().from(finishes).all();
			expect(allFinishes.find((f) => f.id === pen.trim_color_id)?.name).toBe('Silver');
			expect(allFinishes.find((f) => f.id === nib.finish_id)?.name).toBe('Rose Gold');
		});

		it('a populated Price with real currency-noise formatting ($/EUR) is safely ignored — commits cleanly', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'price-populated'),
				inksCSV: fixture('inks', 'empty')
			});

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(1);
		});

		it('populated ledger columns (Usage, Last Inked, etc.) are safely ignored — commits cleanly, nothing derived from them', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'ledger-columns-populated'),
				inksCSV: fixture('inks', 'empty')
			});

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(1);
		});

		it('every directly-copied/computed scalar pen field round-trips exactly: color, notes, ownership_state, created_at vs updated_at', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nullable-fields'),
				inksCSV: fixture('inks', 'empty')
			});

			const before = new Date();
			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.color).toBe('Harbor Blue');
			expect(pen.notes).toBe('A gift from a friend');
			expect(pen.ownership_state).toBe('active');
			// Date Added in nullable-fields.csv is 2025-04-01 — created_at is
			// explicitly backdated to it, not the import-time default.
			expect(pen.created_at).toEqual(new Date('2025-04-01'));
			// updated_at gets the DB default (import time), deliberately NOT
			// backdated to Date Added — the two must differ. unixepoch() is
			// second-granularity, so allow up to 1s of rounding against the
			// millisecond-precision JS clock rather than asserting exact order.
			expect(pen.updated_at.getTime()).not.toBe(pen.created_at.getTime());
			expect(pen.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
		});

		it('a blank Comment leaves pens.notes null, not an empty string', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'nib-bare-point-size'),
				inksCSV: fixture('inks', 'empty')
			});

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.notes).toBeNull();
		});

		it('two rows in the same batch introducing the same brand-new brand create only one brand row, both pens reference it', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'two-rows-same-new-brand'),
				inksCSV: fixture('inks', 'empty')
			});
			decideAllClean(attemptId, 'import');

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(2);

			const allBrands = db.select().from(brands).all();
			expect(allBrands).toHaveLength(1);
			expect(allBrands[0].name).toBe('Emberglass');
			const allPens = db.select().from(pens).all();
			expect(allPens.every((p) => p.brand_id === allBrands[0].id)).toBe(true);
		});

		it('model resolves via exact match specifically in the commit-deferred branch (brand was flagged at parse, settled just before model resolution)', async () => {
			const brand = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const model = db
				.insert(models)
				.values({ brand_id: brand.id, name: 'Vantage' })
				.returning()
				.get();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'model-exact-match-after-brand-resolved'),
				inksCSV: fixture('inks', 'empty')
			});
			const item = flaggedItemsFor(attemptId)[0];
			decideField(item.id, 'brand', 'merge_into', brand.id);

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.model_id).toBe(model.id);
			expect(db.select().from(models).all()).toHaveLength(1);
		});

		it('model resolution respects brand scoping through the full pipeline — a same-named model under a different brand is never a false-positive match', async () => {
			const fernhollow = db.insert(brands).values({ name: 'Fernhollow' }).returning().get();
			const fernhollowModel = db
				.insert(models)
				.values({ brand_id: fernhollow.id, name: 'Journeyman' })
				.returning()
				.get();
			const thistlebrook = db.insert(brands).values({ name: 'Thistlebrook' }).returning().get();
			db.insert(models).values({ brand_id: thistlebrook.id, name: 'Journeyman' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'model-cross-brand-scoping'),
				inksCSV: fixture('inks', 'empty')
			});

			// Brand resolves exactly at parse (Fernhollow pre-seeded), so model
			// resolution — also exact — happens at parse too, no flag at all.
			expect(flaggedItemsFor(attemptId)[0].flag_type).toBeNull();

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			expect(pen.model_id).toBe(fernhollowModel.id);
			expect(db.select().from(models).all()).toHaveLength(2);
		});

		// The pen-side counterpart to "resolves a line at commit time when its
		// brand was itself new at parse" (ink side, above) — model resolution
		// defers exactly the same way when brand.outcome === 'new', not just
		// when it's 'flagged' (the only variant the tests above this one
		// exercised). No brand seeded here at all.
		it('resolves a model at commit time when its brand was itself new at parse — not just when the brand was flagged', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'model-at-commit-when-brand-new'),
				inksCSV: fixture('inks', 'empty')
			});
			decideAllClean(attemptId, 'import');

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const pen = db.select().from(pens).all()[0];
			const brand = db.select().from(brands).all()[0];
			const model = db.select().from(models).all()[0];
			expect(brand.name).toBe('Hollowreed');
			expect(model).toMatchObject({ brand_id: brand.id, name: 'Meridian' });
			expect(pen.model_id).toBe(model.id);
		});

		it('two rows sharing the same new brand AND the same new model create exactly one of each, both pens referencing them — not two competing model rows', async () => {
			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'two-rows-same-new-brand-same-model'),
				inksCSV: fixture('inks', 'empty')
			});
			decideAllClean(attemptId, 'import');

			const result = await commitImportAttempt(db, sqlite, attemptId, backupDir);
			expect(result.pensCreated).toBe(2);

			const allBrands = db.select().from(brands).all();
			const allModels = db.select().from(models).all();
			expect(allBrands).toHaveLength(1);
			expect(allModels).toHaveLength(1);
			expect(allModels[0].brand_id).toBe(allBrands[0].id);
			const allPens = db.select().from(pens).all();
			expect(allPens.every((p) => p.model_id === allModels[0].id)).toBe(true);
		});

		it('a deferred model resolution (brand new at parse) still respects brand scoping — a same-named model under an unrelated existing brand is never a false-positive match', async () => {
			const thistlebrook = db.insert(brands).values({ name: 'Thistlebrook' }).returning().get();
			db.insert(models).values({ brand_id: thistlebrook.id, name: 'Journeyman' }).run();

			const { attemptId } = parseCatalogImport(db, {
				pensCSV: fixture('pens', 'model-cross-brand-scoping-brand-deferred'),
				inksCSV: fixture('inks', 'empty')
			});
			decideAllClean(attemptId, 'import');

			await commitImportAttempt(db, sqlite, attemptId, backupDir);

			const newBrand = db.select().from(brands).where(eq(brands.name, 'Hollowreed')).get()!;
			const allModels = db.select().from(models).all();
			expect(allModels).toHaveLength(2);
			const newModel = allModels.find((m) => m.brand_id === newBrand.id)!;
			expect(newModel).toBeDefined();
			expect(newModel.name).toBe('Journeyman');
			const pen = db.select().from(pens).all()[0];
			expect(pen.model_id).toBe(newModel.id);
		});
	});
});
