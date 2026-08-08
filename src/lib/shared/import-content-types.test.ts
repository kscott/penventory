import { describe, expect, it } from 'vitest';
import {
	IMPORT_CONTENT_TYPE_KEYS,
	IMPORT_CONTENT_TYPES,
	isActiveImportContentType
} from './import-content-types';

describe('IMPORT_CONTENT_TYPE_KEYS', () => {
	it('matches IMPORT_CONTENT_TYPES exactly — kept in sync by hand, verified here', () => {
		expect(IMPORT_CONTENT_TYPE_KEYS).toEqual(IMPORT_CONTENT_TYPES.map((t) => t.key));
	});
});

describe('isActiveImportContentType', () => {
	it('accepts an active content type', () => {
		expect(isActiveImportContentType('pens')).toBe(true);
		expect(isActiveImportContentType('inks')).toBe(true);
	});

	it('rejects a coming_soon content type', () => {
		expect(isActiveImportContentType('inkings')).toBe(false);
	});

	it('rejects an unrecognized value', () => {
		expect(isActiveImportContentType('nibs')).toBe(false);
		expect(isActiveImportContentType('')).toBe(false);
	});
});
