import { isNearDuplicate, similarity } from '../similarity';

// Reuses similarity()/isNearDuplicate() directly — the same function
// resolveOrFlag uses for controlled-list dedup (phase1-plan.md step 3) — one
// implementation of "is this a duplicate," not a per-caller copy. Composite
// keys are built by the caller (fpc-import.ts) from the *original raw* CSV
// field values, joined with a delimiter — Brand|Line|Name|Type for inks,
// Brand|Model|Nib|Color|Material|Trim for pens — since a real near-dupe typo
// shows up in the raw text, not in resolved ids.

export type DuplicateCandidate = { id: number; compositeKey: string };

export type DuplicateMatch = {
	matchType: 'existing' | 'batch';
	id: number;
	compositeKey: string;
	similarity: number;
};

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

// Checks a row's composite key against every already-committed row of that
// type (existing) and every other row already processed in the same import
// batch (batch — nothing in the batch is written until commit, so this is
// the only way to catch two duplicate rows arriving in the same file).
// Exact matches are included too, not treated as automatic no-ops — real
// duplicates happen in FPC exports (see the identity ADR), so even an exact
// repeat still needs an explicit skip/import call.
export function findDuplicateMatches(
	compositeKey: string,
	existing: DuplicateCandidate[],
	batch: DuplicateCandidate[]
): DuplicateMatch[] {
	const normalizedKey = normalize(compositeKey);

	const score = (matchType: 'existing' | 'batch', candidates: DuplicateCandidate[]) =>
		candidates
			.map((candidate) => ({
				matchType,
				id: candidate.id,
				compositeKey: candidate.compositeKey,
				similarity: similarity(normalizedKey, normalize(candidate.compositeKey))
			}))
			.filter(
				(match) =>
					normalize(match.compositeKey) === normalizedKey ||
					isNearDuplicate(normalizedKey, normalize(match.compositeKey))
			);

	return [...score('existing', existing), ...score('batch', batch)].sort(
		(a, b) => b.similarity - a.similarity
	);
}
