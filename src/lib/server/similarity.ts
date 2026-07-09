import damerauLevenshtein from 'damerau-levenshtein';

// Chosen so "Piolt" against "Pilot" — phase1-plan.md step 3's confirmed
// regression case, a single adjacent-letter transposition on a 5-char word —
// clears it (similarity 0.8), while unrelated short names ("Pilot" vs.
// "Sailor") stay well below it. See ARCHITECTURE.md for the full writeup.
export const SIMILARITY_THRESHOLD = 0.7;

// Normalized Damerau-Levenshtein similarity, 0 (nothing alike) to 1 (identical).
// Case-sensitive — callers normalize case/whitespace first.
export function similarity(a: string, b: string): number {
	return damerauLevenshtein(a, b).similarity;
}

export function isNearDuplicate(a: string, b: string): boolean {
	return similarity(a, b) >= SIMILARITY_THRESHOLD;
}

function words(value: string): string[] {
	return value.split(/\s+/).filter(Boolean);
}

// A second, independent signal from character-level similarity — catches
// compound/legal-name variants edit distance misses entirely ("pilot" vs
// "pilot namiki" scores 0.42 on similarity(), nowhere near the threshold,
// but every word of "pilot" appears in order in "pilot namiki"). True when
// the shorter name's words all appear, in order, within the longer name's
// words — same words, not fuzzy per-word. Excludes a===b, since that's an
// exact match handled separately, not a "contains" signal.
export function containsAsWords(a: string, b: string): boolean {
	if (a === b) return false;
	const wordsA = words(a);
	const wordsB = words(b);
	const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
	if (shorter.length === 0) return false;

	let i = 0;
	for (const word of longer) {
		if (i < shorter.length && word === shorter[i]) i++;
	}
	return i === shorter.length;
}
