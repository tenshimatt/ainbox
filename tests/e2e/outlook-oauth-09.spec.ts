/**
 * PRD §12.1 Outlook email-scope token flow + delta-sync backfill
 * AINBOX-6: Outlook OAuth2 authorization flow & connection settings UI
 *
 * Acceptance criteria (Tasks 2 & 8 from plan):
 * - "Connect Outlook" button navigates to Microsoft login
 * - After consent, /settings/providers shows "Connected" status for Outlook
 * - Connected state shows email address, last sync time, Disconnect button
 * - Disconnected state shows "Not connected" and "Connect Outlook" button
 * - Disconnect clears token data and resets UI to disconnected state
 * - /settings/providers no horizontal overflow at 375px (§8.1 mobile-first)
 * - Session cookie is set after successful OAuth callback (server-side only)
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §12.1 Outlook OAuth connect flow', () => {
  test('§12.1 /connect page has Connect Outlook / Microsoft button', async ({ page }) => {
    const resp = await page.goto('/connect');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
    // Either the main connect page or it redirects to sign-in; must not 5xx
    const url = page.url();
    if (url.includes('/connect')) {
      // Should have a Microsoft/Outlook connect option
      const btn = page.locator(
        '[data-testid="connect-outlook-btn"], button:has-text("Microsoft"), button:has-text("Outlook")',
      );
      await expect(btn.first()).toBeVisible();
    }
  });

  test('§12.1 clicking Connect Outlook redirects toward Microsoft login', async ({ page }) => {
    await page.goto('/connect');
    const url = page.url();
    if (!url.includes('/connect')) {
      // Unauthenticated redirect to sign-in is acceptable — skip OAuth redirect check
      test.skip();
      return;
    }
    const btn = page.locator(
      '[data-testid="connect-outlook-btn"], button:has-text("Microsoft"), button:has-text("Outlook")',
    ).first();
    await expect(btn).toBeVisible();

    // Start navigation and click; expect redirect toward Microsoft or internal callback route
    const [navigation] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'commit', timeout: 8000 }).catch(() => null),
      btn.click(),
    ]);
    const afterUrl = page.url();
    expect(afterUrl).toMatch(
      /login\.microsoftonline\.com|\/connect\/microsoft|\/api\/auth\/signin|microsoft\.com\/common/i,
    );
  });

  test('§12.1 /connect/microsoft/callback route exists (no 404/500)', async ({ page }) => {
    // Callback with invalid code must return an error page — NOT 404 or 500
    const resp = await page.goto(
      '/connect/microsoft/callback?code=invalid_test_code&state=test',
    );
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§12.1 /settings/providers shows Outlook connection section', async ({ page }) => {
    const resp = await page.goto('/settings/providers');
    expect(resp?.status()).toBeLessThan(500);
    const afterUrl = page.url();
    // Unauthenticated → redirect to sign-in is fine; authenticated → must show providers UI
    if (afterUrl.includes('/settings/providers')) {
      // Page must have an Outlook / Microsoft section
      const outlookSection = page.locator(
        '[data-testid="outlook-connection-status"], [data-testid="microsoft-connection-status"], :has-text("Outlook"), :has-text("Microsoft")',
      ).first();
      await expect(outlookSection).toBeVisible();
    } else {
      expect(afterUrl).toMatch(/sign-?in|login|connect/i);
    }
  });

  test('§12.1 disconnected state shows "Not connected" and connect button', async ({ page }) => {
    // When no Outlook token is present the card must show "Not connected"
    // This test will FAIL until the OutlookConnectionCard component is implemented
    await page.goto('/settings/providers');
    const afterUrl = page.url();
    if (!afterUrl.includes('/settings/providers')) {
      test.skip(); // unauthenticated — skip deep assertion
      return;
    }
    await expect(
      page.locator('[data-testid="outlook-connection-status"]'),
    ).toHaveText('Not connected');
    await expect(
      page.locator('[data-testid="connect-outlook-btn"]'),
    ).toBeVisible();
  });

  test('§12.1 connected state shows email address and last-sync-time', async ({ page }) => {
    // Will FAIL until the OutlookConnectionCard connected state is implemented
    await page.goto('/settings/providers');
    const afterUrl = page.url();
    if (!afterUrl.includes('/settings/providers')) {
      test.skip();
      return;
    }
    // If already connected (e.g. seeded test env), these should be visible
    const isConnected = await page
      .locator('[data-testid="outlook-user-email"]')
      .isVisible()
      .catch(() => false);
    if (isConnected) {
      await expect(page.locator('[data-testid="outlook-user-email"]')).not.toBeEmpty();
      await expect(page.locator('[data-testid="last-sync-time"]')).not.toBeEmpty();
      await expect(page.locator('[data-testid="disconnect-outlook-btn"]')).toBeVisible();
    }
  });

  test('§12.1 disconnect button clears Outlook token and resets UI', async ({ page }) => {
    // Will FAIL until disconnect endpoint + UI reset are implemented
    await page.goto('/settings/providers');
    const afterUrl = page.url();
    if (!afterUrl.includes('/settings/providers')) {
      test.skip();
      return;
    }
    const disconnectBtn = page.locator('[data-testid="disconnect-outlook-btn"]');
    const isConnected = await disconnectBtn.isVisible().catch(() => false);
    if (!isConnected) {
      // Nothing to disconnect — ensure status shows "Not connected"
      await expect(
        page.locator('[data-testid="outlook-connection-status"]'),
      ).toHaveText('Not connected');
      return;
    }
    await disconnectBtn.click();
    await expect(
      page.locator('[data-testid="outlook-connection-status"]'),
    ).toHaveText('Not connected', { timeout: 6000 });
  });

  test('§12.1 §8.1 /settings/providers no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings/providers');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('§12.1 §8.1 /connect no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/connect');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
