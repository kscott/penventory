import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AnySQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { create } from '../db/repository';
import { resolveOrFlag, type ResolveResult } from '../db/resolve-or-flag';
import { aliases, import_flagged_items, type AliasableType } from '../db/schema';
import type * as schema from '../db/schema';
import type { NibFieldFlag } from './nib-parser';

type Db = BetterSQLite3Database<typeof schema>;
type TableWithId = AnySQLiteTable & { id: SQLiteColumn };
type FlaggedItemRow = typeof import_flagged_items.$inferSelect;

// The shape parseCatalogImport writes to candidate_info for a
// needs_confirmation flag — see fpc-import.ts's determineFlag.
export type NeedsConfirmationCandidateInfo = {
	fields: Record<string, ResolveResult>;
	nibValueFlags: NibFieldFlag[];
	decidedField: string | null;
};

export class CommitRefusedError extends Error {}

function createControlledListRow<T extends TableWithId>(
	db: Db,
	rawName: string,
	scopeId: number | undefined,
	table: T
): number {
	const values = (
		scopeId !== undefined ? { name: rawName, brand_id: scopeId } : { name: rawName }
	) as T['$inferInsert'];
	const created = create(db, table, values) as unknown as { id: number };
	return created.id;
}

// Resolves (and, if genuinely new, creates) a controlled-list entity — safe
// to call sequentially row by row within the same connection, since a 'new'
// entity created for an earlier row is immediately visible (read-your-own-
// writes) to resolveOrFlag calls made for later rows referencing the same
// name, so two rows introducing the same brand-new entity never create two.
// Throws if resolveOrFlag still comes back 'flagged' here — that can only
// happen for a field that was ambiguous but wasn't the one Ken's decision on
// this row actually addressed (see applyDecision below); refusing beats
// silently picking a near-duplicate.
export function settleField<T extends TableWithId>(
	db: Db,
	type: AliasableType,
	rawName: string,
	scopeId: number | undefined,
	table: T
): number {
	const result = resolveOrFlag(db, type, rawName, scopeId);
	if (result.outcome === 'resolved') return result.id;
	if (result.outcome === 'flagged') {
		throw new CommitRefusedError(
			`"${rawName}" (${type}) is still ambiguous and wasn't the field this row's decision addressed`
		);
	}
	return createControlledListRow(db, rawName, scopeId, table);
}

// True when any candidate recorded for this field was flagged via word-
// containment ("Pilot" vs "Pilot Namiki" — every word of the shorter name
// appears, in order, in the longer one). Distinct from a pure character-
// level typo ("Piolt" vs "Pilot"): in this domain, a word-containment match
// is essentially always the same real-world entity under a legal/compound
// name variant, never a coincidentally-similar but genuinely different one
// — Ken's explicit rule, 2026-07-10. A character-typo-only match can still
// legitimately be two distinct entities (short names collide more often),
// so that signal alone doesn't trigger this block.
function hasContainsSignal(item: FlaggedItemRow, field: string): boolean {
	const candidateInfo = item.candidate_info as NeedsConfirmationCandidateInfo | null;
	const fieldResult = candidateInfo?.fields?.[field];
	if (!fieldResult || fieldResult.outcome !== 'flagged') return false;
	return fieldResult.candidates.some((c) => c.reasons.includes('contains'));
}

// A field that was flagged during parse gets its outcome from Ken's decision
// instead of resolving fresh — but decision/decision_target_id on a flagged
// item is single-valued, and a row can (rarely) have more than one ambiguous
// field (see fpc-import.ts's determineFlag). Only the field recorded as
// candidate_info.decidedField gets the special treatment; every other field
// on the row settles normally.
export function applyDecision<T extends TableWithId>(
	db: Db,
	item: FlaggedItemRow,
	field: string,
	type: AliasableType,
	rawName: string,
	scopeId: number | undefined,
	table: T
): number {
	const candidateInfo = item.candidate_info as NeedsConfirmationCandidateInfo | null;
	const isDecidedField = candidateInfo?.decidedField === field;
	if (isDecidedField && item.decision === 'merge_into' && item.decision_target_id) {
		return item.decision_target_id;
	}
	if (isDecidedField && item.decision === 'alias_to' && item.decision_target_id) {
		db.insert(aliases)
			.values({ alias: rawName, aliasable_type: type, aliasable_id: item.decision_target_id })
			.run();
		return item.decision_target_id;
	}
	if (isDecidedField && item.decision === 'import') {
		if (hasContainsSignal(item, field)) {
			throw new CommitRefusedError(
				`"${rawName}" (${type}) can't be created as a separate entity — it was flagged as a ` +
					`word-containment match (e.g. "Pilot" vs "Pilot Namiki"), which is always the same ` +
					`real-world entity under a different name in this domain. Use merge_into or alias_to.`
			);
		}
		// Ken's explicit call: create as new despite the (character-typo-only)
		// fuzzy-match warning — resolveOrFlag would flag it again if asked
		// fresh, so this bypasses it rather than settleField, which would just
		// re-throw.
		return createControlledListRow(db, rawName, scopeId, table);
	}
	return settleField(db, type, rawName, scopeId, table);
}
