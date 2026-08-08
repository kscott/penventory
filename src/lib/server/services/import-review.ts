import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { ImportContentType } from '../../shared/import-content-types';
import { getById } from '../db/repository';
import {
	import_attempts,
	import_flagged_items,
	type ImportDecision,
	type ImportFlagType
} from '../db/schema';
import type * as schema from '../db/schema';
import type { DuplicateMatch } from './duplicate-detection';
import { isItemFullyDecided, reevaluateFlaggedItem } from './fpc-import';

type Db = BetterSQLite3Database<typeof schema>;
type FlaggedItemRow = typeof import_flagged_items.$inferSelect;
type ImportAttemptRow = typeof import_attempts.$inferSelect;

export class ItemNotFoundError extends Error {}

// Only 'open'/'committed' exist today (IMPORT_ATTEMPT_STATUSES) — an explicit
// status check rather than "everything, minus committed" so a future third
// status doesn't silently start showing up on the index unreviewed.
export function listOpenAttempts(db: Db): ImportAttemptRow[] {
	return db.select().from(import_attempts).where(eq(import_attempts.status, 'open')).all();
}

// One open attempt per content type, not one overall — duplicate detection only ever checks the
// real catalog and rows within the same attempt, never across two separate open attempts, so two
// simultaneous pens attempts could each introduce the same new pen and neither would catch it.
// Used both by the upload UI (never offer starting a second one of a type that's already open)
// and defensively by the upload action itself.
export function findOpenAttemptForContentType(
	db: Db,
	contentType: ImportContentType
): ImportAttemptRow | null {
	return (
		db
			.select()
			.from(import_attempts)
			.where(and(eq(import_attempts.status, 'open'), eq(import_attempts.content_type, contentType)))
			.get() ?? null
	);
}

// Display shape for the review page — row_data/candidate_info are stored as
// loosely-typed JSON (schema.ts's `Record<string, unknown>`), so the raw/
// sourceLine unpacking happens once here rather than in the route or the
// template.
// `matches` typed explicitly (possible_duplicate's own candidate list — the
// one shape this step's UI renders specially); every other flag type's
// candidate_info shape (needs_confirmation's per-field candidates,
// unparseable_row's missingFields, ...) is left as opaque JSON here since
// their dedicated review UI is a later step (3b/3c).
export type FlaggedItemView = {
	id: number;
	flagType: ImportFlagType;
	sourceLine: number;
	raw: Record<string, string>;
	candidateInfo: (Record<string, unknown> & { matches?: DuplicateMatch[] }) | null;
	decision: ImportDecision | null;
};

function toItemView(item: FlaggedItemRow): FlaggedItemView {
	const rowData = item.row_data as { raw: Record<string, string>; sourceLine: number };
	return {
		id: item.id,
		// Safe: this function is only ever called on items already filtered to
		// flag_type !== null — see getAttemptReview.
		flagType: item.flag_type as ImportFlagType,
		sourceLine: rowData.sourceLine,
		raw: rowData.raw,
		candidateInfo: item.candidate_info as FlaggedItemView['candidateInfo'],
		decision: item.decision
	};
}

export type AttemptReview = {
	attempt: ImportAttemptRow;
	// Only rows needing a human decision — a clean row is already auto-decided
	// 'import' at parse/re-evaluation time (see writeReevaluatedItem) and has
	// nothing for a reviewer to look at.
	items: FlaggedItemView[];
	// Computed over every row under the attempt, not just the flagged ones
	// shown above — matches what the eventual commit route will actually
	// check.
	commitEnabled: boolean;
};

export function getAttemptReview(db: Db, attemptId: number): AttemptReview | null {
	const attempt = getById(db, import_attempts, attemptId);
	if (!attempt) return null;

	const allItems = db
		.select()
		.from(import_flagged_items)
		.where(eq(import_flagged_items.import_attempt_id, attemptId))
		.all();

	return {
		attempt,
		items: allItems.filter((item) => item.flag_type !== null).map(toItemView),
		commitEnabled: allItems.every(isItemFullyDecided)
	};
}

function getItemInAttempt(db: Db, attemptId: number, itemId: number): FlaggedItemRow {
	const item = getById(db, import_flagged_items, itemId);
	if (!item || item.import_attempt_id !== attemptId) {
		throw new ItemNotFoundError(`item ${itemId} not found in attempt ${attemptId}`);
	}
	return item;
}

// possible_duplicate/unparseable_nib/unparseable_row's row-level decision —
// the simplest shape (see isItemFullyDecided): import as-is, or skip. Needs_
// confirmation's per-field decisions are a separate mechanism (field_decisions,
// step 3b) not exercised through this function.
export function decideFlaggedItem(
	db: Db,
	attemptId: number,
	itemId: number,
	decision: 'import' | 'skip'
): void {
	getItemInAttempt(db, attemptId, itemId);
	db.update(import_flagged_items)
		.set({ decision, decided_at: new Date() })
		.where(eq(import_flagged_items.id, itemId))
		.run();
}

// Generic per-row raw-field edit, for any flagged row regardless of flag
// type — delegates the actual re-resolution to reevaluateFlaggedItem, which
// already re-runs field resolution, re-checks duplicates against the real
// catalog and sibling pending items, and determines the new flag (or clears
// it, auto-deciding 'import').
export function editFlaggedItem(
	db: Db,
	attemptId: number,
	itemId: number,
	correctedRaw: Record<string, string>
): void {
	const item = getItemInAttempt(db, attemptId, itemId);
	reevaluateFlaggedItem(db, item, correctedRaw);
}
