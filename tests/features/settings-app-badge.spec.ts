/**
 * Settings page — app name and version badge
 *
 * Acceptance criteria:
 * - Badge with "Ainbox" app name and version is visible on the settings page
 * - Badge has the correct data-testid attribute
 * - No horizontal overflow at 375px viewport
 */

import { test, expect } from '@playwright/test';

test.use({
  extraHTTPHeaders: { 'x-e2e-test-bypass-auth': 'true' },
});

test.describe('@feature settings app version badge', () => {
  test('renders app name and version badge on settings page', async ({ page }) => {
    const resp = await page.goto('/settings');
    expect(resp?.status()).toBeLessThan(500);

    const badge = page.getByTestId('app-version-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Ainbox');
    await expect(badge).toContainText('v0.1.0');
  });

  test('badge is visible alongside the Settings heading', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
    await expect(page.getByTestId('app-version-badge')).toBeVisible();
  });

  test('no horizontal overflow at 375px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings');

    await expect(page.getByTestId('app-version-badge')).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
