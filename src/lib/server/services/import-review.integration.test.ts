import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../db/migrate';
import { import_attempts, import_flagged_items } from '../db/schema';
import { parseCatalogImport } from './fpc-import';
import {
	decideFlaggedItem,
	editFlaggedItem,
	findOpenAttemptForContentType,
	getAttemptReview,
	ItemNotFoundError,
	listOpenAttempts
} from './import-review';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'fpc-export');

function fixture(kind: 'pens' | 'inks', name: string): string {
	return readFileSync(join(FIXTURES_DIR, kind, `${name}.csv`), 'utf-8');
}

function rawOf(item: { row_data: unknown }): Record<string, string> {
	return (item.row_data as { raw: Record<string, string> }).raw;
}

describe('import-review', () => {
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

	function flaggedItemsFor(attemptId: number) {
		return db
			.select()
			.from(import_flagged_items)
			.where(eq(import_flagged_items.import_attempt_id, attemptId))
			.all()
			.sort((a, b) => a.id - b.id);
	}

	describe('listOpenAttempts', () => {
		it('returns an open attempt but not one already marked committed', () => {
			const { attemptId: openId } = parseCatalogImport(db, {
				csv: fixture('pens', 'nullable-fields'),
				contentType: 'pens'
			});
			const { attemptId: committedId } = parseCatalogImport(db, {
				csv: fixture('pens', 'nullable-fields'),
				contentType: 'pens'
			});
			db.update(import_attempts)
				.set({ status: 'committed', committed_at: new Date() })
				.where(eq(import_attempts.id, committedId))
				.run();

			const ids = listOpenAttempts(db).map((a) => a.id);
			expect(ids).toContain(openId);
			expect(ids).not.toContain(committedId);
		});
	});

	describe('findOpenAttemptForContentType', () => {
		it('returns null when nothing is open for that content type', () => {
			expect(findOpenAttemptForContentType(db, 'pens')).toBeNull();
		});

		it('finds the open attempt for a content type, ignoring a different content type and a committed one', () => {
			const { attemptId: openPensId } = parseCatalogImport(db, {
				csv: fixture('pens', 'nullable-fields'),
				contentType: 'pens'
			});
			parseCatalogImport(db, { csv: fixture('inks', 'with-line'), contentType: 'inks' });
			const { attemptId: committedPensId } = parseCatalogImport(db, {
				csv: fixture('pens', 'nullable-fields'),
				contentType: 'pens'
			});
			db.update(import_attempts)
				.set({ status: 'committed', committed_at: new Date() })
				.where(eq(import_attempts.id, committedPensId))
				.run();

			const found = findOpenAttemptForContentType(db, 'pens');
			expect(found?.id).toBe(openPensId);
		});
	});

	describe('getAttemptReview', () => {
		it('returns null for an attempt id that does not exist', () => {
			expect(getAttemptReview(db, 999)).toBeNull();
		});

		it('lists only flagged rows, not the clean auto-decided ones, and reports commitEnabled false while a row is still undecided', () => {
			const { attemptId } = parseCatalogImport(db, {
				csv: fixture('pens', 'exact-duplicate'),
				contentType: 'pens'
			});

			const review = getAttemptReview(db, attemptId)!;
			expect(review.items).toHaveLength(1);
			expect(review.items[0].flagType).toBe('possible_duplicate');
			expect(review.items[0].candidateInfo?.matches).toBeDefined();
			expect(review.commitEnabled).toBe(false);
		});

		it('reports commitEnabled true once every flagged row has a decision', () => {
			const { attemptId } = parseCatalogImport(db, {
				csv: fixture('pens', 'exact-duplicate'),
				contentType: 'pens'
			});
			const [, flagged] = flaggedItemsFor(attemptId);

			decideFlaggedItem(db, attemptId, flagged.id, 'import');

			expect(getAttemptReview(db, attemptId)!.commitEnabled).toBe(true);
		});
	});

	describe('decideFlaggedItem', () => {
		it('persists the decision and decided_at on the row', () => {
			const { attemptId } = parseCatalogImport(db, {
				csv: fixture('pens', 'exact-duplicate'),
				contentType: 'pens'
			});
			const [, flagged] = flaggedItemsFor(attemptId);

			decideFlaggedItem(db, attemptId, flagged.id, 'skip');

			const updated = flaggedItemsFor(attemptId).find((i) => i.id === flagged.id)!;
			expect(updated.decision).toBe('skip');
			expect(updated.decided_at).not.toBeNull();
		});

		it('refuses an item id that belongs to a different attempt', () => {
			const { attemptId: attemptA } = parseCatalogImport(db, {
				csv: fixture('pens', 'exact-duplicate'),
				contentType: 'pens'
			});
			const { attemptId: attemptB } = parseCatalogImport(db, {
				csv: fixture('pens', 'nullable-fields'),
				contentType: 'pens'
			});
			const [, flaggedInA] = flaggedItemsFor(attemptA);

			expect(() => decideFlaggedItem(db, attemptB, flaggedInA.id, 'import')).toThrow(
				ItemNotFoundError
			);
		});

		it('refuses an item id that does not exist', () => {
			const { attemptId } = parseCatalogImport(db, {
				csv: fixture('pens', 'exact-duplicate'),
				contentType: 'pens'
			});

			expect(() => decideFlaggedItem(db, attemptId, 999, 'import')).toThrow(ItemNotFoundError);
		});
	});

	describe('editFlaggedItem', () => {
		it('re-evaluates the row through the same pipeline reevaluateFlaggedItem uses directly, persisting a field edit that does not clear the flag', () => {
			const { attemptId } = parseCatalogImport(db, {
				csv: fixture('pens', 'exact-duplicate'),
				contentType: 'pens'
			});
			const [, flagged] = flaggedItemsFor(attemptId);

			editFlaggedItem(db, attemptId, flagged.id, { ...rawOf(flagged), Comment: 'noted' });

			const updated = flaggedItemsFor(attemptId).find((i) => i.id === flagged.id)!;
			expect(updated.flag_type).toBe('possible_duplicate');
			expect(rawOf(updated).Comment).toBe('noted');
			expect(updated.decision).toBeNull();
		});

		it('auto-decides import once an edit clears the flag entirely, same as a never-flagged row', () => {
			const { attemptId } = parseCatalogImport(db, {
				csv: fixture('pens', 'exact-duplicate'),
				contentType: 'pens'
			});
			const [, flagged] = flaggedItemsFor(attemptId);

			editFlaggedItem(db, attemptId, flagged.id, { ...rawOf(flagged), Color: 'Teal' });

			const updated = flaggedItemsFor(attemptId).find((i) => i.id === flagged.id)!;
			expect(updated.flag_type).toBeNull();
			expect(updated.decision).toBe('import');
		});

		it('refuses an item id that belongs to a different attempt', () => {
			const { attemptId: attemptA } = parseCatalogImport(db, {
				csv: fixture('pens', 'exact-duplicate'),
				contentType: 'pens'
			});
			const { attemptId: attemptB } = parseCatalogImport(db, {
				csv: fixture('pens', 'nullable-fields'),
				contentType: 'pens'
			});
			const [, flaggedInA] = flaggedItemsFor(attemptA);

			expect(() => editFlaggedItem(db, attemptB, flaggedInA.id, rawOf(flaggedInA))).toThrow(
				ItemNotFoundError
			);
		});
	});
});
