import { describe, expect, it } from 'vitest';
import { brandId, brands } from './schema';

describe('schema helpers', () => {
	it('brandId resolves lines/models.brand_id to brands.id', () => {
		expect(brandId()).toBe(brands.id);
	});
});
