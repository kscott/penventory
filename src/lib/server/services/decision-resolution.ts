import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AnySQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { create } from '../db/repository';
import { resolveOrFlag, type ResolveResult } from '../db/resolve-or-flag';
import {
	aliases,
	import_flagged_items,
	type AliasableType,
	type ImportDecision
} from '../db/schema';
import type * as schema from '../db/schema';
import type { NibFieldFlag } from './nib-parser';

type Db = BetterSQLite3Database<typeof schema>;
export type TableWithId = AnySQLiteTable & { id: SQLiteColumn };
type FlaggedItemRow = typeof import_flagged_items.$inferSelect;

// The shape parseCatalogImport writes to candidate_info — see fpc-import.ts's
// determineFlag. No "decidedField" — every key in `fields` and every entry in
// `nibValueFlags` is independently decidable via field_decisions (see
// docs/adr/2026-07-10-per-field-decisions-not-per-row.md). A row can have
// more than one ambiguous field at once (e.g. a typo on Brand *and* on
// Material) and each gets its own answer, not just the first one found.
//
// `matches`/`unparseableNibReason` can be present *alongside* `fields`/
// `nibValueFlags` on the same row — a duplicate match and a field ambiguity
// (or an unparseable nib) are independent signals that can both be true at
// once (e.g. a row that's a near-dupe of an existing pen on Model/Color/
// Material/Trim while its Brand is also a typo). flag_type picks one
// "headline" reason for the review UI, but candidate_info always carries
// every signal that actually fired — see
// docs/adr/2026-07-10-flag-signals-are-not-mutually-exclusive.md. Before that
// fix, determineFlag's if/else chain silently discarded whichever signal
// wasn't the headline one.
export type FlagCandidateInfo = {
	matches?: {
		matchType: 'existing' | 'batch';
		id: number;
		compositeKey: string;
		similarity: number;
	}[];
	unparseableNibReason?: string;
	fields: Record<string, ResolveResult>;
	nibValueFlags: NibFieldFlag[];
};

// Old name, kept as an alias — every current usage already reads `.fields`/
// `.nibValueFlags` the same way, so no call site needed to change.
export type NeedsConfirmationCandidateInfo = FlagCandidateInfo;

export type FieldDecisions = Record<
	string,
	{ decision: ImportDecision; decisionTargetId: number | null }
>;

export class CommitRefusedError extends Error {}

// Exported for fpc-import.ts's deferred model/line resolution (brand context
// wasn't known at parse time) — it needs the exact same "create if genuinely
// new" step settleField uses internally, but wrapped with its own
// flagged-outcome handling (push a pending re-flag rather than throw) instead
// of settleField's throw-on-still-ambiguous behavior.
export function createControlledListRow<T extends TableWithId>(
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
// happen for a field that's ambiguous but has no recorded field_decision
// (see applyDecision below); refusing beats silently picking a near-dupe.
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
			`"${rawName}" (${type}) is still ambiguous and has no recorded decision`
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

// A field that was flagged during parse gets its outcome from its own entry
// in item.field_decisions, keyed by field name — every ambiguous field on a
// row is independently decidable, not just one per row (see
// docs/adr/2026-07-10-per-field-decisions-not-per-row.md). A field with no
// entry falls through to settleField, which throws if it's still ambiguous —
// refusing beats silently picking a near-duplicate for a field nobody
// actually decided.
export function applyDecision<T extends TableWithId>(
	db: Db,
	item: FlaggedItemRow,
	field: string,
	type: AliasableType,
	rawName: string,
	scopeId: number | undefined,
	table: T
): number {
	const fieldDecisions = item.field_decisions as FieldDecisions | null;
	const fieldDecision = fieldDecisions?.[field];

	if (fieldDecision?.decision === 'merge_into' && fieldDecision.decisionTargetId) {
		return fieldDecision.decisionTargetId;
	}
	if (fieldDecision?.decision === 'alias_to' && fieldDecision.decisionTargetId) {
		db.insert(aliases)
			.values({
				alias: rawName,
				aliasable_type: type,
				aliasable_id: fieldDecision.decisionTargetId
			})
			.run();
		return fieldDecision.decisionTargetId;
	}
	if (fieldDecision?.decision === 'import') {
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

// nib_base_size/nib_purity are exact-match-only (never fuzzy-matched — see
// the nib-value-lookup-tables-not-enums ADR), so there's no candidate to
// pick between; the only question is "add this as a new value or not,"
// which still requires an explicit field_decision (decision: 'import')
// rather than being created unconditionally — nothing gets written to the
// catalog without a decision behind it, same rule as every other field.
export function findOrCreateExactMatchWithDecision<T extends TableWithId & { name: SQLiteColumn }>(
	db: Db,
	item: FlaggedItemRow,
	field: string,
	table: T,
	name: string
): number {
	const existing = db.select().from(table).where(eq(table.name, name)).get();
	if (existing) return existing.id;

	const fieldDecisions = item.field_decisions as FieldDecisions | null;
	if (fieldDecisions?.[field]?.decision !== 'import') {
		throw new CommitRefusedError(
			`"${name}" (${field}) needs an explicit decision to add it as a new value`
		);
	}
	const created = db
		.insert(table)
		.values({ name } as T['$inferInsert'])
		.returning()
		.get() as unknown as {
		id: number;
	};
	return created.id;
}
