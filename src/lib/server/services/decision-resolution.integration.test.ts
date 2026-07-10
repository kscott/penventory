import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../db/migrate';
import { aliases, brands, import_attempts, import_flagged_items } from '../db/schema';
import type { MatchReason } from '../db/resolve-or-flag';
import { applyDecision, CommitRefusedError, settleField } from './decision-resolution';
import type { NeedsConfirmationCandidateInfo } from './decision-resolution';

// Exercises applyDecision/settleField directly — the full decision
// permutation matrix, independent of CSV parsing — per Ken's request for an
// explicit bundle proving exactly what's allowed to be created and what
// isn't, not just that the pieces run.

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
		field: string,
		reasons: MatchReason[],
		candidateId = 999
	): NeedsConfirmationCandidateInfo {
		return {
			decidedField: field,
			nibValueFlags: [],
			fields: {
				[field]: {
					outcome: 'flagged',
					candidates: [{ id: candidateId, name: 'existing-brand', similarity: 0.8, reasons }]
				}
			}
		};
	}

	function insertFlaggedItem(opts: {
		decision?: 'import' | 'skip' | 'merge_into' | 'alias_to' | null;
		decisionTargetId?: number | null;
		candidateInfo?: NeedsConfirmationCandidateInfo | null;
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
				decision_target_id: opts.decisionTargetId ?? null
			})
			.returning()
			.get();
	}

	describe('this field is the one the flag names (isDecidedField = true)', () => {
		it('merge_into + a target id — reuses the existing id, creates nothing', () => {
			const existing = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const item = insertFlaggedItem({
				decision: 'merge_into',
				decisionTargetId: existing.id,
				candidateInfo: candidateInfoFor('brand', ['fuzzy'])
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands);

			expect(id).toBe(existing.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
			expect(db.select().from(aliases).all()).toEqual([]);
		});

		it('merge_into with no target id — falls through, refuses rather than guessing', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			const item = insertFlaggedItem({
				decision: 'merge_into',
				decisionTargetId: null,
				candidateInfo: candidateInfoFor('brand', ['fuzzy'])
			});

			expect(() =>
				applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands)
			).toThrow(CommitRefusedError);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('alias_to + a target id — records the alias, reuses the existing id, creates no new brand', () => {
			const existing = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			const item = insertFlaggedItem({
				decision: 'alias_to',
				decisionTargetId: existing.id,
				candidateInfo: candidateInfoFor('brand', ['fuzzy'])
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands);

			expect(id).toBe(existing.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
			expect(db.select().from(aliases).all()).toEqual([
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
				decision: 'alias_to',
				decisionTargetId: null,
				candidateInfo: candidateInfoFor('brand', ['fuzzy'])
			});

			expect(() =>
				applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands)
			).toThrow(CommitRefusedError);
			expect(db.select().from(brands).all()).toHaveLength(1);
			expect(db.select().from(aliases).all()).toEqual([]);
		});

		it('import + character-typo-only reasons ("fuzzy") — ALLOWED: creates a genuinely separate row', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			const item = insertFlaggedItem({
				decision: 'import',
				candidateInfo: candidateInfoFor('brand', ['fuzzy'])
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Wavecrst', undefined, brands);

			const allBrands = db.select().from(brands).all();
			expect(allBrands).toHaveLength(2);
			expect(allBrands.find((b) => b.id === id)?.name).toBe('Wavecrst');
		});

		it('import + word-containment-only reasons ("contains") — DISALLOWED: refuses, creates nothing', () => {
			db.insert(brands).values({ name: 'Larkspur' }).run();
			const item = insertFlaggedItem({
				decision: 'import',
				candidateInfo: candidateInfoFor('brand', ['contains'])
			});

			expect(() =>
				applyDecision(db, item, 'brand', 'brand', 'Larkspur Pen Company', undefined, brands)
			).toThrow(CommitRefusedError);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('import + both "fuzzy" and "contains" reasons — DISALLOWED: contains alone is enough to block it', () => {
			db.insert(brands).values({ name: 'Larkspur' }).run();
			const item = insertFlaggedItem({
				decision: 'import',
				candidateInfo: candidateInfoFor('brand', ['fuzzy', 'contains'])
			});

			expect(() =>
				applyDecision(db, item, 'brand', 'brand', 'Larkspur Pen Company', undefined, brands)
			).toThrow(CommitRefusedError);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('import + malformed candidate_info (decidedField set, but no matching entry in fields) — fails safe, does not block or crash', () => {
			// candidate_info is loosely-typed JSON out of a DB column, not
			// compiler-enforced — decidedField could in principle point at a
			// field with no recorded candidates at all (e.g. a future caller
			// bug). hasContainsSignal has no evidence of 'contains' here, so it
			// must not block; absence of evidence isn't evidence of a contains
			// match. Proves the defensive branch returns false rather than
			// throwing a TypeError on the missing lookup.
			const item = insertFlaggedItem({
				decision: 'import',
				candidateInfo: { decidedField: 'brand', nibValueFlags: [], fields: {} }
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Brand New Co', undefined, brands);

			const allBrands = db.select().from(brands).all();
			expect(allBrands).toHaveLength(1);
			expect(allBrands[0].id).toBe(id);
		});
	});

	describe('this field is NOT the one the flag names (isDecidedField = false)', () => {
		it('decision is ignored entirely — an already-resolved value just resolves, regardless of decision', () => {
			const existing = db.insert(brands).values({ name: 'Wavecrest' }).returning().get();
			// decidedField is 'model', not 'brand' — this call is for 'brand'.
			const item = insertFlaggedItem({
				decision: 'import',
				candidateInfo: candidateInfoFor('model', ['fuzzy'])
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Wavecrest', undefined, brands);

			expect(id).toBe(existing.id);
			expect(db.select().from(brands).all()).toHaveLength(1);
		});

		it('a genuinely new value on a non-decided field still gets created — no ambiguity to block it', () => {
			const item = insertFlaggedItem({
				decision: 'import',
				candidateInfo: candidateInfoFor('model', ['fuzzy'])
			});

			const id = applyDecision(db, item, 'brand', 'brand', 'Brand New Co', undefined, brands);

			const allBrands = db.select().from(brands).all();
			expect(allBrands).toHaveLength(1);
			expect(allBrands[0].id).toBe(id);
			expect(allBrands[0].name).toBe('Brand New Co');
		});

		it('a second, undecided ambiguous field on the same row refuses rather than silently picking a near-match', () => {
			db.insert(brands).values({ name: 'Wavecrest' }).run();
			// The flag only ever named 'model' as decidedField — 'brand' here is
			// a second field that also happens to be ambiguous, but nobody
			// decided it.
			const item = insertFlaggedItem({
				decision: 'merge_into',
				decisionTargetId: 1,
				candidateInfo: candidateInfoFor('model', ['fuzzy'])
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
