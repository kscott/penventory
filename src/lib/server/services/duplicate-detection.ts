import { isNearDuplicate, similarity } from '../similarity';

// Two-stage matching, not a single fuzzy comparison over one joined string.
// Confirmed necessary against Ken's real collection data (2026-07-10): a
// whole-composite-key fuzzy comparison let a long *shared* prefix (Brand,
// Model, Material, Trim Color are identical across every colorway of the
// same pen line — completely normal in a real collection) drown out the one
// field that's actually supposed to differ. Two genuinely distinct pens
// ("Esterbrook Estie Aqua" vs "Esterbrook Estie Maui", identical in every
// other field) scored similarity ~0.9 on the old whole-string approach —
// comfortably past the 0.7 threshold — producing a false "possible
// duplicate" on nearly half of a real ~540-row import.
//
// Stage 1 (`groupKey`): exact match only. Built from *resolved* identity —
// real database ids where a field resolved cleanly, a stable `new:<name>`
// marker where it's about to be created — never raw text compared fuzzily.
// See fpc-import.ts's identity-key builders for how this is constructed.
// Stage 2 (`freeText`): fuzzy-or-exact match, but only ever run against
// candidates that already passed stage 1 — isolates the actual
// identity-distinguishing field (Color for pens, Name for inks) instead of
// letting it get diluted by everything else in the row.
export type IdentityCandidate = { id: number; groupKey: string; freeText: string };

export type DuplicateMatch = {
	matchType: 'existing' | 'batch';
	id: number;
	groupKey: string;
	freeText: string;
	similarity: number;
};

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

// Checks a row's (groupKey, freeText) identity against every already-
// committed row of that type (existing) and every other row already
// processed in the same import batch (batch — nothing in the batch is
// written until commit, so this is the only way to catch two duplicate rows
// arriving in the same file). Exact freeText matches are included too, not
// treated as automatic no-ops — real duplicates happen in FPC exports (see
// the identity ADR), so even an exact repeat still needs an explicit
// skip/import call.
export function findDuplicateMatches(
	groupKey: string,
	freeText: string,
	existing: IdentityCandidate[],
	batch: IdentityCandidate[] = []
): DuplicateMatch[] {
	const normalizedGroupKey = normalize(groupKey);
	const normalizedFreeText = normalize(freeText);

	const score = (matchType: 'existing' | 'batch', candidates: IdentityCandidate[]) =>
		candidates
			.filter((candidate) => normalize(candidate.groupKey) === normalizedGroupKey)
			.map((candidate) => ({
				matchType,
				id: candidate.id,
				groupKey: candidate.groupKey,
				freeText: candidate.freeText,
				similarity: similarity(normalizedFreeText, normalize(candidate.freeText))
			}))
			.filter(
				(match) =>
					normalize(match.freeText) === normalizedFreeText ||
					isNearDuplicate(normalizedFreeText, normalize(match.freeText))
			);

	return [...score('existing', existing), ...score('batch', batch)].sort(
		(a, b) => b.similarity - a.similarity
	);
}
