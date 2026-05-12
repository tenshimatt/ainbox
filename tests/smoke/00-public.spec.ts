import { test, expect } from '@playwright/test';

test.describe('@smoke public surfaces', () => {
  test('landing page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Task Response/i);
  });

  // Each marketing page is a SEPARATE test, not a for-loop.
  // page.goto in a tight loop in one test causes
  // "Navigation interrupted by another navigation" — the previous
  // request hasn't fully loaded before the next one starts.
  for (const path of ['/pricing', '/security', '/legal/privacy', '/legal/terms']) {
    test(`marketing page exists: ${path}`, async ({ page }) => {
      const resp = await page.goto(path, { waitUntil: 'load' });
      expect(resp?.status()).toBeLessThan(500);
    });
  }
});
