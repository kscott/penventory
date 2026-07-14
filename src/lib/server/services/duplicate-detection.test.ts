import { describe, expect, it } from 'vitest';
import { findDuplicateMatches } from './duplicate-detection';

describe('findDuplicateMatches', () => {
	it('finds an exact match against an existing catalog row', () => {
		const matches = findDuplicateMatches('id:1|id:2|id:3', 'Kon-peki', [
			{ id: 1, groupKey: 'id:1|id:2|id:3', freeText: 'Kon-peki' }
		]);
		expect(matches).toEqual([
			{
				matchType: 'existing',
				id: 1,
				groupKey: 'id:1|id:2|id:3',
				freeText: 'Kon-peki',
				similarity: 1
			}
		]);
	});

	it('finds a near-duplicate typo in freeText, within the same exact group', () => {
		const matches = findDuplicateMatches('id:1|id:2|id:3', 'Kon-peki', [
			{ id: 1, groupKey: 'id:1|id:2|id:3', freeText: 'Kon-peko' }
		]);
		expect(matches).toHaveLength(1);
		expect(matches[0].matchType).toBe('existing');
		expect(matches[0].similarity).toBeGreaterThan(0.7);
	});

	it('finds a duplicate against another row already processed in the same batch', () => {
		const matches = findDuplicateMatches(
			'id:1|id:2|id:3',
			'Clear',
			[],
			[{ id: 0, groupKey: 'id:1|id:2|id:3', freeText: 'Clear' }]
		);
		expect(matches).toEqual([
			{ matchType: 'batch', id: 0, groupKey: 'id:1|id:2|id:3', freeText: 'Clear', similarity: 1 }
		]);
	});

	it('does not flag rows in a different group, no matter how similar the free text is', () => {
		const matches = findDuplicateMatches('id:1|id:2|id:3', 'Kon-peki', [
			{ id: 1, groupKey: 'id:9|id:9|id:9', freeText: 'Kon-peki' }
		]);
		expect(matches).toEqual([]);
	});

	it('does not flag genuinely different free text within the same group — the real regression this design closes', () => {
		// The exact shape that broke on real data: same group (same Brand/
		// Model/Material/Trim identity), completely different Color/Name.
		const matches = findDuplicateMatches('id:1|id:2|id:3', 'Aqua', [
			{ id: 1, groupKey: 'id:1|id:2|id:3', freeText: 'Maui' }
		]);
		expect(matches).toEqual([]);
	});

	it('is case-insensitive and trims whitespace on both groupKey and freeText', () => {
		const matches = findDuplicateMatches(' ID:1|ID:2|ID:3 ', ' Kon-peki ', [
			{ id: 1, groupKey: 'id:1|id:2|id:3', freeText: 'kon-peki' }
		]);
		expect(matches).toHaveLength(1);
		expect(matches[0].similarity).toBe(1);
	});

	it('checks both existing and batch candidates, sorted by similarity descending', () => {
		const matches = findDuplicateMatches(
			'id:1|id:2|id:3',
			'Kon-peki',
			[{ id: 1, groupKey: 'id:1|id:2|id:3', freeText: 'Kon-peko' }],
			[{ id: 0, groupKey: 'id:1|id:2|id:3', freeText: 'Kon-peki' }]
		);
		expect(matches).toHaveLength(2);
		expect(matches[0]).toMatchObject({ matchType: 'batch', similarity: 1 });
		expect(matches[1]).toMatchObject({ matchType: 'existing' });
		expect(matches[1].similarity).toBeLessThan(1);
	});
});
