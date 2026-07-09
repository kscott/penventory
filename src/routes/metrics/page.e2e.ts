import { expect, test } from '@playwright/test';

test('/metrics exposes valid Prometheus format', async ({ request }) => {
	const response = await request.get('/metrics');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');

	const body = await response.text();
	expect(body).toMatch(/^# HELP /m);
	expect(body).toMatch(/^# TYPE /m);
	expect(body).toContain('process_cpu_user_seconds_total');
});
