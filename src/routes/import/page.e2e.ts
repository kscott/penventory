import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'fpc-export');

function fixturePath(kind: 'pens' | 'inks', name: string): string {
	return join(FIXTURES_DIR, kind, `${name}.csv`);
}

function fixture(kind: 'pens' | 'inks', name: string): Buffer {
	return readFileSync(fixturePath(kind, name));
}

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

// The e2e suite shares one server/DB across every test file, so other
// attempts (this file's own second call, other test files' uploads) can
// legitimately already exist — assertions here only check that these two
// specific attempts are present and link correctly, never the full list.
// Both created via the raw route (no one-open-per-type restriction there —
// see the upload-form tests below for that rule), so reusing 'pens' twice is
// fine here regardless of what other files have already opened.
test("/import lists open attempts and links into each one's own review page", async ({
	page,
	request
}) => {
	const first = await uploadAttempt(request, 'pens', 'nullable-fields');
	const second = await uploadAttempt(request, 'pens', 'nullable-fields');

	await page.goto('/import');
	await expect(page.getByRole('link', { name: `#${first}`, exact: false })).toBeVisible();
	const secondLink = page.getByRole('link', { name: `#${second}`, exact: false });
	await expect(secondLink).toBeVisible();

	await secondLink.click();
	await expect(page).toHaveURL(`/import/${second}`);
	await expect(page.getByRole('heading', { name: `Attempt #${second} — pens` })).toBeVisible();
});

// No other test file touches the 'inks' content type — reserved here so this
// file has exclusive control over its open/available state, since the
// upload-form tests below depend on ordering (inks starts available, the
// upload test opens it, the refusal test depends on it already being open).
test('upload form: inks starts available, submitting starts a new attempt and lands on its review page', async ({
	page
}) => {
	await page.goto('/import');

	await expect(page.getByText('Coming soon')).toBeVisible(); // inkings, always inert
	const inksRow = page.locator('.upload-row', { hasText: 'Inks' });
	await expect(inksRow.locator('input[type="file"]')).toBeVisible();

	await inksRow.locator('input[type="file"]').setInputFiles(fixturePath('inks', 'with-line'));
	await inksRow.getByRole('button', { name: 'Upload' }).click();

	await expect(page).toHaveURL(/\/import\/\d+$/);
	await expect(page.getByRole('heading', { name: /Attempt #\d+ — inks/ })).toBeVisible();
	await expect(page.getByText('No flagged rows')).toBeVisible();

	await page.goto('/import');
	await expect(page.locator('.upload-row', { hasText: 'Inks' }).getByRole('link')).toHaveText(
		/Already open/
	);
});

test('starting a second upload of an already-open type is refused server-side (not reachable via the UI itself)', async ({
	request
}) => {
	// Relies on the previous test having left an open inks attempt — the UI
	// itself would never offer this combination (an already-open type
	// renders as a link, not a file input), so this exercises the action's
	// own defense-in-depth check directly instead.
	//
	// Accept: text/html is required here — without it SvelteKit treats the
	// request as a fetch()-driven submission and wraps the result in a JSON
	// envelope with the outer HTTP status always 200 (the real status lives
	// inside the body instead). A real browser's plain <form> POST (what
	// use:enhance-free actions actually run under, and what the page.click()
	// test above exercises) sends this header automatically.
	const response = await request.post('/import?/upload', {
		headers: { ...ORIGIN_HEADER, accept: 'text/html' },
		multipart: {
			file: {
				name: 'collected_inks.csv',
				mimeType: 'text/csv',
				buffer: fixture('inks', 'with-line')
			},
			contentType: 'inks'
		}
	});

	expect(response.status()).toBe(409);
});
