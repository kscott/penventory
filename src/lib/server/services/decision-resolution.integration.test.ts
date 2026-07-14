import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../db/migrate';
import {
	aliases,
	brands,
	import_attempts,
	import_flagged_items,
	pen_materials
} from '../db/schema';
import type { MatchReason } from '../db/resolve-or-flag';
import { applyDecision, CommitRefusedError, settleField } from './decision-resolution';
import type { FieldDecisions, NeedsConfirmationCandidateInfo } from './decision-resolution';

// Exercises applyDecision/settleField directly — the full decision
// permutation matrix, independent of CSV parsing — per Ken's request for an
// explicit bundle proving exactly what's allowed to be created and what
// isn't, not just that the pieces run. Field examples below use Brand and
// Material (both genuinely resolvable/flaggable controlled-list fields) —
// not Color, which is freeform text with no resolution at all.

describe('applyDecision / settleField — decision permutation matrix', () => {
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

	function candidateInfoFor(
		fields: Record<string, MatchReason[]>,
		candidateId = 999
	): NeedsConfirmationCandidateInfo {
		const result: NeedsConfirmationCandidateInfo['fields'] = {};
		for (const [field, reasons] of Object.entries(fields)) {
			result[field] = {
				outcome: 'flagged',
				candidates: [{ id: candidateId, name: 'existing-value', similarity: 0.8, reasons }]
			};
		}
		return { fields: result, nibValueFlags: [] };
	}

	function insertFlaggedItem(opts: {
		decision?: 'import' | 'skip' | 'merge_into' | 'alias_to' | null;
		candidateInfo?: NeedsConfirmationCandidateInfo | null;
		fieldDecisions?: FieldDecisions | null;
	}) {
		const attempt = db
			.insert(import_attempts)
			.values({ operation_type: 'catalog_import' })
			.returning()
			.get();
		return db
			.insert(import_flagged_items)
			.values({
				import_attempt_id: attempt.id,
				row_data: { entityType: 'pen', raw: {} },
				flag_type: opts.candidateInfo ? 'needs_confirmation' : null,
				candidate_info: opts.candidateInfo ?? null,
				decision: opts.decision ?? null,
				field_decisions: opts.fieldDecisions ?? null
			})
			.returning()
			.get();
	}

	describe('this field has its own entry in field_decisions', () => {
		it('merge_into + a target id — reuses the existing id, creates nothing', () => {
			const existing = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['fuzzy'] }),
				fieldDecisions: { brand: { decision: 'merge_into', decisionTargetId: existing.id } }
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands);

			expect(id).toBe(existing.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
			// aliases isn't empty to start with — migration seeds a few (see
			// the vocabulary-seeding ADR), none of them brand-type — filter to
			// brand aliases specifically rather than assuming the table starts
			// empty.
			expect(
				db
					.select()
					.from(aliases)
					.all()
					.filter((a) => a.aliasable_type === 'brand')
			).toEqual([]);
		});

		it('merge_into with no target id — falls through, refuses rather than guessing', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['fuzzy'] }),
				fieldDecisions: { brand: { decision: 'merge_into', decisionTargetId: null } }
			});

			expect(() =>
				applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands)
			).toThrow(CommitRefusedError);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('alias_to + a target id — records the alias, reuses the existing id, creates no new brand', () => {
			const existing = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['fuzzy'] }),
				fieldDecisions: { brand: { decision: 'alias_to', decisionTargetId: existing.id } }
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands);

			expect(id).toBe(existing.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
			// aliases isn't empty to start with — migration seeds a few (see
			// the vocabulary-seeding ADR), none of them brand-type — filter to
			// brand aliases specifically rather than assuming the table starts
			// empty.
			expect(
				db
					.select()
					.from(aliases)
					.all()
					.filter((a) => a.aliasable_type === 'brand')
			).toEqual([
				expect.objectContaining({
					alias: 'Wavecrst',
					aliasable_type: 'brand',
					aliasable_id: existing.id
				})
			]);
		});

		it('alias_to with no target id — falls through, refuses rather than guessing', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['fuzzy'] }),
				fieldDecisions: { brand: { decision: 'alias_to', decisionTargetId: null } }
			});

			expect(() =>
				applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands)
			).toThrow(CommitRefusedError);
			expect(db.select().from(brands).all()).toHaveLength(1);
			// aliases isn't empty to start with — migration seeds a few (see
			// the vocabulary-seeding ADR), none of them brand-type — filter to
			// brand aliases specifically rather than assuming the table starts
			// empty.
			expect(
				db
					.select()
					.from(aliases)
					.all()
					.filter((a) => a.aliasable_type === 'brand')
			).toEqual([]);
		});

		it('import + character-typo-only reasons ("fuzzy") — ALLOWED: creates a genuinely separate row', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['fuzzy'] }),
				fieldDecisions: { brand: { decision: 'import', decisionTargetId: null } }
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands);

			const allBrands = db.select().from(brands).all();
			expect(allBrands).toHaveLength(2);
			expect(allBrands.find((b) => b.id === id)?.name).toBe('Wavecrst');
		});

		it('import + word-containment-only reasons ("contains") — DISALLOWED: refuses, creates nothing', () => {
			db.insert(brands).values({ name: 'Larkspur' }).run();
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['contains'] }),
				fieldDecisions: { brand: { decision: 'import', decisionTargetId: null } }
			});

			expect(() =>
				applyDecision(db, item, 'brand', 'brand', 'Larkspur Pen Company', undefined, brands)
			).toThrow(CommitRefusedError);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('import + both "fuzzy" and "contains" reasons — DISALLOWED: contains alone is enough to block it', () => {
			db.insert(brands).values({ name: 'Larkspur' }).run();
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['fuzzy', 'contains'] }),
				fieldDecisions: { brand: { decision: 'import', decisionTargetId: null } }
			});

			expect(() =>
				applyDecision(db, item, 'brand', 'brand', 'Larkspur Pen Company', undefined, brands)
			).toThrow(CommitRefusedError);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('import + malformed candidate_info (field_decisions has an entry, but candidate_info has none) — fails safe, does not block or crash', () => {
			// candidate_info/field_decisions are loosely-typed JSON out of DB
			// columns, not compiler-enforced — a field could in principle have
			// a field_decisions entry with no matching candidate_info (e.g. a
			// future caller bug). hasContainsSignal has no evidence of
			// 'contains' here, so it must not block; absence of evidence isn't
			// evidence of a contains match.
			const item = insertFlaggedItem({
				candidateInfo: { fields: {}, nibValueFlags: [] },
				fieldDecisions: { brand: { decision: 'import', decisionTargetId: null } }
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Brand New Co', undefined, brands);

			const allBrands = db.select().from(brands).all();
			expect(allBrands).toHaveLength(1);
			expect(allBrands[0].id).toBe(id);
		});
	});

	describe('two fields flagged on the same row, each independently decided — the real fix for the "only the first is workable" gap', () => {
		it('a typo on Brand AND a typo on Material, on the same row, both get applied correctly in one commit', () => {
			const existingBrand = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const existingMaterial = db
				.insert(pen_materials)
				.values({ name: 'Acrylic' })
				.returning()
				.get();

			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['fuzzy'], pen_material: ['fuzzy'] }),
				fieldDecisions: {
					brand: { decision: 'merge_into', decisionTargetId: existingBrand.id },
					pen_material: { decision: 'merge_into', decisionTargetId: existingMaterial.id }
				}
			});

			const brandId = applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands);
			const materialId = applyDecision(
				db,
				item,
				'pen_material',
				'pen_material',
				'Acylic',
				undefined,
				pen_materials
			);

			expect(brandId).toBe(existingBrand.id);
			expect(materialId).toBe(existingMaterial.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
			expect(db.select().from(pen_materials).all()).toHaveLength(1);
		});

		it('a typo on Brand AND a typo on Material, only Brand decided — Material still refuses at commit, not silently created', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			db.insert(pen_materials).values({ name: 'Acrylic' }).run();

			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['fuzzy'], pen_material: ['fuzzy'] }),
				fieldDecisions: {
					brand: { decision: 'merge_into', decisionTargetId: 1 }
					// pen_material has no entry — not decided.
				}
			});

			// Brand resolves fine on its own.
			expect(applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands)).toBe(1);
			// Material, still ambiguous with nothing decided for it, refuses.
			expect(() =>
				applyDecision(db, item, 'pen_material', 'pen_material', 'Acylic', undefined, pen_materials)
			).toThrow(CommitRefusedError);
			expect(db.select().from(pen_materials).all()).toHaveLength(1);
		});
	});

	describe('this field has no entry in field_decisions at all', () => {
		it('an already-resolved value just resolves — nothing to decide', () => {
			const existing = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ pen_material: ['fuzzy'] }),
				fieldDecisions: { pen_material: { decision: 'import', decisionTargetId: null } }
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Wavecrest', undefined, brands);

			expect(id).toBe(existing.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('a genuinely new value on an undecided field still gets created — no ambiguity to block it', () => {
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ pen_material: ['fuzzy'] }),
				fieldDecisions: { pen_material: { decision: 'import', decisionTargetId: null } }
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Brand New Co', undefined, brands);

			const allBrands = db.select().from(brands).all();
			expect(allBrands).toHaveLength(1);
			expect(allBrands[0].id).toBe(id);
			expect(allBrands[0].name).toBe('Brand New Co');
		});

		it('a genuinely ambiguous field with no field_decisions entry refuses rather than silently picking a near-match', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			const item = insertFlaggedItem({
				candidateInfo: candidateInfoFor({ brand: ['fuzzy'] }),
				fieldDecisions: null
			});

			expect(() =>
				applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands)
			).toThrow(CommitRefusedError);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});
	});

	describe('settleField directly (the fallback path applyDecision delegates to)', () => {
		it('resolved — returns the existing id, creates nothing', () => {
			const existing = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			expect(settleField(db, 'brand', 'Wavecrest', undefined, brands)).toBe(existing.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('new — creates a row and returns its id', () => {
			const id = settleField(db, 'brand', 'Brand New Co', undefined, brands);
			const allBrands = db.select().from(brands).all();
			expect(allBrands).toHaveLength(1);
			expect(allBrands[0].id).toBe(id);
		});

		it('flagged — refuses, creates nothing', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			expect(() => settleField(db, 'brand', 'Wavecrst', undefined, brands)).toThrow(
				CommitRefusedError
			);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});
	});
});
