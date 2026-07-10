import { describe, expect, it } from 'vitest';
import { findDuplicateMatches } from './duplicate-detection';

describe('findDuplicateMatches', () => {
	it('finds an exact match against an existing catalog row', () => {
		const matches = findDuplicateMatches(
			'Pilot|Iroshizuku|Kon-peki|bottle',
			[{ id: 1, compositeKey: 'Pilot|Iroshizuku|Kon-peki|bottle' }],
			[]
		);
		expect(matches).toEqual([
			{
				matchType: 'existing',
				id: 1,
				compositeKey: 'Pilot|Iroshizuku|Kon-peki|bottle',
				similarity: 1
			}
		]);
	});

	it('finds a near-duplicate typo against an existing catalog row', () => {
		const matches = findDuplicateMatches(
			'Pilot|Iroshizuku|Kon-peki|bottle',
			[{ id: 1, compositeKey: 'Pilot|Iroshizuku|Kon-peki|bottel' }],
			[]
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].matchType).toBe('existing');
		expect(matches[0].similarity).toBeGreaterThan(0.7);
	});

	it('finds a duplicate against another row already processed in the same batch', () => {
		const matches = findDuplicateMatches(
			'Pilot|Custom 823|M|Clear|Acrylic|Gold',
			[],
			[{ id: 0, compositeKey: 'Pilot|Custom 823|M|Clear|Acrylic|Gold' }]
		);
		expect(matches).toEqual([
			{
				matchType: 'batch',
				id: 0,
				compositeKey: 'Pilot|Custom 823|M|Clear|Acrylic|Gold',
				similarity: 1
			}
		]);
	});

	it('does not flag genuinely different rows', () => {
		const matches = findDuplicateMatches(
			'Pilot|Iroshizuku|Kon-peki|bottle',
			[{ id: 1, compositeKey: 'Sailor|Jentle|Yama-dori|bottle' }],
			[]
		);
		expect(matches).toEqual([]);
	});

	it('is case-insensitive and trims whitespace', () => {
		const matches = findDuplicateMatches(
			' PILOT|Iroshizuku|Kon-peki|bottle ',
			[{ id: 1, compositeKey: 'pilot|Iroshizuku|Kon-peki|bottle' }],
			[]
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].similarity).toBe(1);
	});

	it('checks both existing and batch candidates, sorted by similarity descending', () => {
		const matches = findDuplicateMatches(
			'Pilot|Iroshizuku|Kon-peki|bottle',
			[{ id: 1, compositeKey: 'Pilot|Iroshizuku|Kon-peko|bottle' }],
			[{ id: 0, compositeKey: 'Pilot|Iroshizuku|Kon-peki|bottle' }]
		);
		expect(matches).toHaveLength(2);
		expect(matches[0]).toMatchObject({ matchType: 'batch', similarity: 1 });
		expect(matches[1]).toMatchObject({ matchType: 'existing' });
		expect(matches[1].similarity).toBeLessThan(1);
	});
});
