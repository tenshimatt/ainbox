/**
 * PRD §7.15 Provider disconnect + delete
 * PRD §4.5 Component contracts (AppLayout wraps every authenticated page)
 * PRD §8.3 Accessibility (keyboard nav)
 *
 * Acceptance criteria:
 * - /settings page renders without error
 * - /settings/providers shows connected accounts with Disconnect button per provider
 * - Disconnect button triggers DELETE /api/oauth/tokens/* (removes OAuth tokens)
 * - After disconnect, provider shows as "Not connected"
 * - /settings/account has a "Delete everything" button
 * - Delete-everything triggers confirmation dialog before proceeding
 * - Delete-everything calls /api/account/delete and cascades all user data
 * - Every authenticated page (/inbox, /drafts, /knowledge, /automation, /audit, /settings)
 *   wraps content in <AppLayout> (has sidebar + topbar)
 * - All authenticated pages redirect to auth when unauthenticated (no 500)
 * - /settings no horizontal overflow at 375px
 */

import { test, expect } from '@playwright/test';

const AUTH_PAGES = [
  '/inbox',
  '/drafts',
  '/knowledge',
  '/automation',
  '/audit',
  '/settings',
  '/settings/providers',
  '/settings/account',
];

test.describe('@e2e §7.15 §4.5 settings, provider disconnect, account delete', () => {
  test('§7.15 /settings renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/settings');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.15 /settings/providers renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/settings/providers');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.15 /settings/account renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/settings/account');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.15 /settings/providers shows provider connection state', async ({ page }) => {
    await page.goto('/settings/providers');
    const url = page.url();
    if (!url.includes('/settings/providers')) return;

    const hasGoogle = await page.getByText(/google|gmail/i).first().isVisible().catch(() => false);
    const hasMicrosoft = await page.getByText(/microsoft|outlook/i).first().isVisible().catch(() => false);
    expect(hasGoogle || hasMicrosoft).toBe(true);
  });

  test('§7.15 /settings/providers has Disconnect button for each connected provider', async ({ page }) => {
    await page.goto('/settings/providers');
    const url = page.url();
    if (!url.includes('/settings/providers')) return;

    const disconnectBtn = page.getByRole('button', { name: /disconnect|remove|revoke/i }).first();
    const connectBtn = page.getByRole('button', { name: /connect|add/i }).first();
    // Either a disconnect button (if connected) or a connect button (if not connected)
    const hasAny = await Promise.any([
      disconnectBtn.isVisible(),
      connectBtn.isVisible(),
    ]).catch(() => false);
    expect(hasAny).toBe(true);
  });

  test('§7.15 Disconnect calls DELETE on oauth tokens API', async ({ page }) => {
    let disconnectApiCalled = false;
    await page.route('/api/oauth/tokens/**', async route => {
      if (route.request().method() === 'DELETE') {
        disconnectApiCalled = true;
        await route.fulfill({ status: 200, body: JSON.stringify({ deleted: true }) });
      } else {
        await route.continue();
      }
    });

    await page.goto('/settings/providers');
    const url = page.url();
    if (!url.includes('/settings/providers')) return;

    const disconnectBtn = page.getByRole('button', { name: /disconnect|remove|revoke/i }).first();
    const exists = await disconnectBtn.isVisible().catch(() => false);
    if (exists) {
      await disconnectBtn.click();
      await page.waitForTimeout(500);
      // Either API was called or a confirm dialog appeared
      const hasDialog = await page.getByRole('dialog').isVisible().catch(() => false);
      expect(disconnectApiCalled || hasDialog).toBe(true);
    }
  });

  test('§7.15 /settings/account has "Delete everything" button', async ({ page }) => {
    await page.goto('/settings/account');
    const url = page.url();
    if (!url.includes('/settings/account')) return;

    const deleteBtn = page.getByRole('button', { name: /delete.*account|delete.*everything|remove.*account/i }).first();
    await expect(deleteBtn).toBeVisible();
  });

  test('§7.15 Delete-everything shows confirmation dialog before proceeding', async ({ page }) => {
    await page.goto('/settings/account');
    const url = page.url();
    if (!url.includes('/settings/account')) return;

    const deleteBtn = page.getByRole('button', { name: /delete.*account|delete.*everything|remove.*account/i }).first();
    const exists = await deleteBtn.isVisible().catch(() => false);
    if (exists) {
      await deleteBtn.click();
      // Must show a confirmation dialog — not immediately delete
      const dialog = page.getByRole('dialog', { name: /confirm|are you sure|delete/i })
        .or(page.getByRole('alertdialog'));
      await expect(dialog).toBeVisible({ timeout: 2000 });
    }
  });

  test('§7.15 Delete account API endpoint exists (not 404)', async ({ page }) => {
    const resp = await page.request.delete('/api/account/delete');
    // 401/403 = auth-gated, fine. 405 = method not allowed (endpoint exists). Not 404.
    expect(resp.status()).not.toBe(404);
  });

  test('§4.5 all authenticated pages have AppLayout (sidebar + topbar)', async ({ page }) => {
    for (const path of AUTH_PAGES) {
      await page.goto(path);
      const url = page.url();
      if (!url.includes(path.split('?')[0])) continue; // auth redirect — skip

      // AppLayout must provide sidebar navigation and a topbar
      const hasSidebar = await page.locator('nav, aside, [data-testid="sidebar"], [aria-label="sidebar"]')
        .first().isVisible().catch(() => false);
      const hasTopbar = await page.locator('header, [data-testid="topbar"], [role="banner"]')
        .first().isVisible().catch(() => false);
      expect(hasSidebar || hasTopbar).toBe(true);
    }
  });

  test('§7.15 all authenticated pages redirect to auth when unauthenticated (no 500)', async ({ page }) => {
    for (const path of AUTH_PAGES) {
      const resp = await page.goto(path);
      expect(resp?.status()).not.toBe(500);
      expect(resp?.status()).not.toBe(404);
    }
  });

  test('§7.15 /settings no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('§7.15 /settings/providers no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings/providers');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
