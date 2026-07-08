import { expect, test } from '@playwright/test';

test('home page loads', async ({ page }) => {
	const response = await page.goto('/');
	expect(response?.status()).toBe(200);
	await expect(page.locator('body')).toBeVisible();
});

test('nav renders', async ({ page }) => {
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Primary' });
	await expect(nav).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Collection' })).toBeVisible();
});

test('header layout is responsive at a mobile breakpoint', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 667 });
	await page.goto('/');

	const header = page.locator('header');
	await expect(header).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
	await expect(header).toHaveCSS('flex-direction', 'column');
});
