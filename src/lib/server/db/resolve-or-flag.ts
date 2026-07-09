import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { containsAsWords, isNearDuplicate, similarity } from '../similarity';
import {
	aliases,
	brands,
	filling_systems,
	finishes,
	lines,
	models,
	nib_materials,
	nib_shapes,
	pen_materials,
	vendors,
	type AliasableType
} from './schema';
import type * as schema from './schema';

type Db = BetterSQLite3Database<typeof schema>;

// Unscoped: one canonical name per table. Scoped: canonical name is only
// unique per brand_id (two brands can each legitimately have a "Classic"
// line), so resolution needs a brand_id to disambiguate.
const UNSCOPED_TABLES = {
	brand: brands,
	pen_material: pen_materials,
	nib_material: nib_materials,
	finish: finishes,
	filling_system: filling_systems,
	nib_shape: nib_shapes,
	vendor: vendors
} as const;

const SCOPED_TABLES = {
	line: lines,
	model: models
} as const;

type UnscopedType = keyof typeof UNSCOPED_TABLES;
type ScopedType = keyof typeof SCOPED_TABLES;

function isScopedType(type: AliasableType): type is ScopedType {
	return type === 'line' || type === 'model';
}

// A candidate can be flagged for either or both reasons — character-level
// similarity ("Piolt" vs "Pilot") and word-level containment ("Pilot" vs
// "Pilot Namiki", which similarity() alone misses entirely). Both signals
// are recorded rather than one overwriting the other, so the review report
// can show why a candidate was surfaced.
export type MatchReason = 'fuzzy' | 'contains';
export type ResolveCandidate = {
	id: number;
	name: string;
	similarity: number;
	reasons: MatchReason[];
};

export type ResolveResult =
	| { outcome: 'resolved'; id: number; via: 'exact' | 'alias' }
	| { outcome: 'flagged'; candidates: ResolveCandidate[] }
	| { outcome: 'new' };

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

// Four outcomes, checked in order — see phase1-plan.md step 3:
//   1. Exact match (case-insensitive, trimmed) on the canonical name.
//   2. Exact match on a known alias.
//   3. Fuzzy-similar OR word-contained by an existing name, no exact/alias
//      match — flagged, never auto-created. Two independent signals because
//      they catch different drift shapes: character-level typos ("Piolt")
//      vs. compound/legal-name variants ("Pilot Namiki") that read as
//      character-dissimilar but obviously the same brand.
//   4. No match at all, by either signal — safe to create as genuinely new.
export function resolveOrFlag(
	db: Db,
	type: AliasableType,
	rawName: string,
	scopeId?: number
): ResolveResult {
	if (isScopedType(type)) {
		if (scopeId === undefined) {
			throw new Error(`resolveOrFlag: type "${type}" requires a scopeId (brand_id)`);
		}
	} else if (scopeId !== undefined) {
		throw new Error(`resolveOrFlag: type "${type}" does not accept a scopeId`);
	}

	const normalizedName = normalize(rawName);

	const rows = isScopedType(type)
		? db
				.select()
				.from(SCOPED_TABLES[type])
				.where(eq(SCOPED_TABLES[type].brand_id, scopeId as number))
				.all()
		: db
				.select()
				.from(UNSCOPED_TABLES[type as UnscopedType])
				.all();

	const exact = rows.find((row) => normalize(row.name) === normalizedName);
	if (exact) {
		return { outcome: 'resolved', id: exact.id, via: 'exact' };
	}

	const aliasRows = db.select().from(aliases).where(eq(aliases.aliasable_type, type)).all();
	const matchingAlias = aliasRows.find((row) => normalize(row.alias) === normalizedName);
	if (matchingAlias && rows.some((row) => row.id === matchingAlias.aliasable_id)) {
		return { outcome: 'resolved', id: matchingAlias.aliasable_id, via: 'alias' };
	}

	const candidates = rows
		.map((row) => {
			const normalizedRowName = normalize(row.name);
			const reasons: MatchReason[] = [];
			if (isNearDuplicate(normalizedName, normalizedRowName)) reasons.push('fuzzy');
			if (containsAsWords(normalizedName, normalizedRowName)) reasons.push('contains');
			return {
				id: row.id,
				name: row.name,
				similarity: similarity(normalizedName, normalizedRowName),
				reasons
			};
		})
		.filter((candidate) => candidate.reasons.length > 0)
		.sort((a, b) => b.similarity - a.similarity);
	if (candidates.length > 0) {
		return { outcome: 'flagged', candidates };
	}

	return { outcome: 'new' };
}
