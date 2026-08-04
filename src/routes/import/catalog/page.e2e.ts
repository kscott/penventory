import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'fpc-export');

function fixture(kind: 'pens' | 'inks', name: string): Buffer {
	return readFileSync(join(FIXTURES_DIR, kind, `${name}.csv`));
}

// SvelteKit's CSRF check requires a same-origin Origin header on any
// multipart/form POST — a real browser sends this automatically; Playwright's
// `request` fixture doesn't, so every test here sets it explicitly.
const ORIGIN_HEADER = { origin: 'http://localhost:4173' };

test('POST /import/catalog parses uploaded CSVs and returns a new attempt id', async ({
	request
}) => {
	const response = await request.post('/import/catalog', {
		headers: ORIGIN_HEADER,
		multipart: {
			pens: {
				name: 'collected_pens.csv',
				mimeType: 'text/csv',
				buffer: fixture('pens', 'nullable-fields')
			},
			inks: {
				name: 'collected_inks.csv',
				mimeType: 'text/csv',
				buffer: fixture('inks', 'with-line')
			}
		}
	});

	expect(response.status()).toBe(201);
	const body = await response.json();
	expect(typeof body.attemptId).toBe('number');
});

test('POST /import/catalog rejects a request missing the "inks" file', async ({ request }) => {
	const response = await request.post('/import/catalog', {
		headers: ORIGIN_HEADER,
		multipart: {
			pens: {
				name: 'collected_pens.csv',
				mimeType: 'text/csv',
				buffer: fixture('pens', 'nullable-fields')
			}
		}
	});

	expect(response.status()).toBe(400);
});

test('POST /import/catalog rejects malformed CSV content with a clear error, not a raw 500', async ({
	request
}) => {
	const response = await request.post('/import/catalog', {
		headers: ORIGIN_HEADER,
		multipart: {
			pens: {
				name: 'collected_pens.csv',
				mimeType: 'text/csv',
				buffer: Buffer.from('Brand;Model\n"unterminated quote;Rambler\n')
			},
			inks: {
				name: 'collected_inks.csv',
				mimeType: 'text/csv',
				buffer: fixture('inks', 'with-line')
			}
		}
	});

	expect(response.status()).toBe(400);
	const body = await response.json();
	expect(body.error).toContain('could not parse');
});
