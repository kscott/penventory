import { describe, expect, it } from 'vitest';
import { containsAsWords, isNearDuplicate, SIMILARITY_THRESHOLD, similarity } from './similarity';

describe('similarity', () => {
	it('scores identical strings as 1', () => {
		expect(similarity('Pilot', 'Pilot')).toBe(1);
	});

	it('scores an adjacent-letter transposition as a near-duplicate ("Piolt" vs "Pilot")', () => {
		// phase1-plan.md step 3's confirmed regression case: one Damerau-Levenshtein
		// step on a 5-char word => similarity 0.8, above the 0.7 threshold.
		expect(similarity('Piolt', 'Pilot')).toBe(0.8);
		expect(isNearDuplicate('Piolt', 'Pilot')).toBe(true);
	});

	it('does not flag unrelated short names as near-duplicates', () => {
		expect(isNearDuplicate('Pilot', 'Sailor')).toBe(false);
	});

	it("is case-sensitive — normalization is the caller's responsibility", () => {
		expect(similarity('Pilot', 'pilot')).toBeLessThan(1);
	});

	it('treats a value exactly at the threshold as a near-duplicate', () => {
		expect(SIMILARITY_THRESHOLD).toBe(0.7);
		// 3 substitutions / 10 chars = similarity 0.7 exactly.
		expect(similarity('abcdefghij', 'xyzdefghij')).toBe(0.7);
		expect(isNearDuplicate('abcdefghij', 'xyzdefghij')).toBe(true);
	});

	// Real, distinct vendor names one edit apart — confirms a single insertion
	// on an otherwise-real word still clears the threshold. resolveOrFlag
	// still just flags this for a decision; it never silently merges it.
	it('flags a single-insertion near-miss between two real distinct brands ("Platinum" vs "Platignum")', () => {
		expect(similarity('platinum', 'platignum')).toBeCloseTo(0.889, 3);
		expect(isNearDuplicate('platinum', 'platignum')).toBe(true);
	});

	it('flags a doubled-letter typo ("Lamy" vs "Lammy")', () => {
		expect(similarity('lamy', 'lammy')).toBe(0.8);
		expect(isNearDuplicate('lamy', 'lammy')).toBe(true);
	});

	it('flags a dropped-letter typo ("Lamy" vs "Lay")', () => {
		expect(similarity('lamy', 'lay')).toBe(0.75);
		expect(isNearDuplicate('lamy', 'lay')).toBe(true);
	});
});

describe('containsAsWords', () => {
	it('is true when a shorter name is a word-prefix of a longer one ("pilot" in "pilot namiki")', () => {
		expect(containsAsWords('pilot', 'pilot namiki')).toBe(true);
	});

	it('is true regardless of which argument is longer', () => {
		expect(containsAsWords('pilot namiki', 'pilot')).toBe(true);
	});

	it('is true when the shorter name is a word-suffix of a longer one ("namiki" in "pilot namiki")', () => {
		expect(containsAsWords('namiki', 'pilot namiki')).toBe(true);
	});

	it('is true for a non-contiguous in-order subsequence ("pilot company" in "pilot pen company")', () => {
		expect(containsAsWords('pilot company', 'pilot pen company')).toBe(true);
	});

	it('is false when character similarity is also low and no word-level containment exists ("pilot" vs "sailor")', () => {
		expect(containsAsWords('pilot', 'sailor')).toBe(false);
	});

	it('is false for two names sharing a word out of order ("company pilot" vs "pilot pen company")', () => {
		expect(containsAsWords('company pilot', 'pilot pen company')).toBe(false);
	});

	it('is false for identical strings — exact match is a different outcome, not a "contains" signal', () => {
		expect(containsAsWords('pilot', 'pilot')).toBe(false);
	});

	it('is false when the shorter side is blank — no words to vacuously satisfy the subsequence check', () => {
		expect(containsAsWords('  ', 'pilot namiki')).toBe(false);
	});

	// This is exactly the case Damerau-Levenshtein similarity misses (0.42,
	// nowhere near SIMILARITY_THRESHOLD) that containsAsWords exists to catch.
	it('catches what character-level similarity misses ("pilot" vs "pilot namiki")', () => {
		expect(isNearDuplicate('pilot', 'pilot namiki')).toBe(false);
		expect(containsAsWords('pilot', 'pilot namiki')).toBe(true);
	});
});
