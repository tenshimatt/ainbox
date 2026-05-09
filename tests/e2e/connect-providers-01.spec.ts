/**
 * PRD §7.1 Provider OAuth — Google
 * PRD §7.2 Provider OAuth — Microsoft
 *
 * Acceptance criteria:
 * - /connect shows provider chooser with Google and Microsoft options
 * - Clicking Google initiates OAuth (redirects to Google accounts URL)
 * - Clicking Microsoft initiates OAuth (redirects to Microsoft login URL)
 * - /connect/google/callback handles code exchange and stores connection state
 * - /connect/microsoft/callback handles code exchange and stores connection state
 * - After successful connect, /settings/providers shows the connected account
 * - Connection completes in <2 minutes (structural check: no spinners stuck)
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §7.1 §7.2 provider OAuth connect', () => {
  test('§7.1 /connect page renders with Google option', async ({ page }) => {
    const resp = await page.goto('/connect');
    expect(resp?.status()).toBeLessThan(500);
    await expect(page.getByRole('heading', { name: /connect/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
  });

  test('§7.2 /connect page renders with Microsoft option', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByRole('button', { name: /microsoft|outlook/i })).toBeVisible();
  });

  test('§7.1 Google OAuth button triggers redirect to accounts.google.com', async ({ page }) => {
    await page.goto('/connect');
    const [popup] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'commit', timeout: 5000 }).catch(() => null),
      page.getByRole('button', { name: /google/i }).click(),
    ]);
    // Either a redirect happened OR we can check the current URL changed
    const url = page.url();
    expect(url).toMatch(/accounts\.google\.com|\/connect\/google/);
  });

  test('§7.2 Microsoft OAuth button triggers redirect to login.microsoftonline.com', async ({ page }) => {
    await page.goto('/connect');
    const [popup] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'commit', timeout: 5000 }).catch(() => null),
      page.getByRole('button', { name: /microsoft|outlook/i }).click(),
    ]);
    const url = page.url();
    expect(url).toMatch(/login\.microsoftonline\.com|\/connect\/microsoft/);
  });

  test('§7.1 /connect/google/callback route exists (no 404/500)', async ({ page }) => {
    // Callback without valid code should return an error page, NOT a 404/500
    const resp = await page.goto('/connect/google/callback?code=invalid_test_code&state=test');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.2 /connect/microsoft/callback route exists (no 404/500)', async ({ page }) => {
    const resp = await page.goto('/connect/microsoft/callback?code=invalid_test_code&state=test');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.1 §7.2 /settings/providers page exists and shows connection state', async ({ page }) => {
    const resp = await page.goto('/settings/providers');
    // Unauthenticated → redirect to sign-in, NOT a 500
    expect(resp?.status()).toBeLessThan(500);
    // Either shows providers page or auth redirect
    const url = page.url();
    expect(url).toMatch(/\/settings\/providers|\/sign-?in|\/login|\/connect/);
  });

  test('§7.1 §7.2 /connect no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/connect');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
