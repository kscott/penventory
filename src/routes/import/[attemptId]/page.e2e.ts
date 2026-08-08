import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'fpc-export');

function fixture(kind: 'pens' | 'inks', name: string): Buffer {
	return readFileSync(join(FIXTURES_DIR, kind, `${name}.csv`));
}

// Same CSRF requirement as the catalog upload route's own e2e tests — a real
// browser sends Origin automatically, Playwright's `request` fixture doesn't.
const ORIGIN_HEADER = { origin: 'http://localhost:4173' };

async function uploadAttempt(
	request: APIRequestContext,
	contentType: 'pens' | 'inks',
	fixtureName: string
): Promise<number> {
	const response = await request.post('/import/catalog', {
		headers: ORIGIN_HEADER,
		multipart: {
			file: {
				name: `collected_${contentType}.csv`,
				mimeType: 'text/csv',
				buffer: fixture(contentType, fixtureName)
			},
			contentType
		}
	});
	const body = await response.json();
	return body.attemptId;
}

// exact-duplicate.csv's two identical pen rows flag the second as
// possible_duplicate — the one flag type this fixture reliably produces,
// and enough to drive both the generic edit path and the row-level decide
// path this step built.
test('review page: editing a flagged row round-trips through re-evaluation, and deciding it flips the commit-enabled indicator', async ({
	page,
	request
}) => {
	const attemptId = await uploadAttempt(request, 'pens', 'exact-duplicate');

	await page.goto(`/import/${attemptId}`);
	await expect(page.getByText('possible duplicate')).toBeVisible();
	await expect(page.getByText('Some rows still need a decision')).toBeVisible();

	// Comment isn't part of the pen identity key or the fuzzy-compared Color
	// field, so editing it round-trips the raw value without clearing the
	// duplicate flag — proving the edit itself persisted and re-evaluated,
	// independent of the decision step below.
	const commentInput = page.locator('input[name="raw.Comment"]');
	await commentInput.fill('verified, keeping both');
	await page.getByRole('button', { name: 'Save & re-evaluate' }).click();

	await expect(page.locator('input[name="raw.Comment"]')).toHaveValue('verified, keeping both');
	await expect(page.getByText('possible duplicate')).toBeVisible();
	await expect(page.getByText('Some rows still need a decision')).toBeVisible();

	await page.getByRole('button', { name: 'Import anyway' }).click();

	await expect(page.getByText('decision: import')).toBeVisible();
	await expect(page.getByText('Every row is decided. Ready to commit.')).toBeVisible();
});

test('review page returns a 404 for an import attempt that does not exist', async ({ request }) => {
	const response = await request.get('/import/999999');
	expect(response.status()).toBe(404);
});
