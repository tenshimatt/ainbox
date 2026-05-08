import { test, expect } from '@playwright/test';

test.describe('@smoke public surfaces', () => {
  test('landing page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Ainbox/i);
  });
  test('marketing pages exist', async ({ page }) => {
    for (const path of ['/pricing', '/security', '/legal/privacy', '/legal/terms']) {
      const resp = await page.goto(path);
      expect(resp?.status()).toBeLessThan(500);
    }
  });
});
