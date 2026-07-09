import { expect, test } from '@playwright/test';

test('/healthz returns 200', async ({ request }) => {
	const response = await request.get('/healthz');
	expect(response.status()).toBe(200);
});
