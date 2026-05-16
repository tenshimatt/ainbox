/**
 * AINBOX-50 — Merge L3: /settings/account UI to detect + merge duplicate accounts
 *
 * Acceptance criteria:
 * - Account tab shows a "Duplicate Accounts" section
 * - When API returns no duplicates → shows "No duplicate accounts detected"
 * - When API returns duplicates → lists each with a "Merge" button
 * - Clicking Merge opens a confirmation dialog
 * - Confirming calls POST /api/account/merge with the correct duplicate_user_id
 * - After successful merge, the duplicate row is removed from the list
 * - When merge API returns an error → shows a friendly error message
 * - Loading state is shown while the API is in-flight
 */

import { test, expect } from '@playwright/test';

const DUP_A = {
  id: 'dup-uuid-aaa',
  email: 'user@example.com',
  created_at: new Date('2025-01-15T10:00:00Z').toISOString(),
};
const DUP_B = {
  id: 'dup-uuid-bbb',
  email: 'user@example.com',
  created_at: new Date('2025-03-20T14:30:00Z').toISOString(),
};

/** Mock the OAuth tokens + skills endpoints so the settings page loads cleanly */
async function mockSettingsDeps(page: Parameters<typeof test>[1] extends (...args: infer A) => unknown ? A[0] : never) {
  // Bypass middleware auth check (dev-only cookie, never present in production)
  await page.context().addCookies([
    { name: '__e2e_auth_bypass__', value: 'true', domain: 'localhost', path: '/' },
  ]);

  await page.route('**/api/oauth/tokens', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, providers: [], userEmail: 'user@example.com' }),
    });
  });
  await page.route('**/api/skills', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ skills: [] }),
    });
  });
}

// ─── Section presence ─────────────────────────────────────────────────────────

test.describe('@feature AINBOX-50 duplicate account detection', () => {
  test('Account tab shows Duplicate Accounts section', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [] }),
      });
    });

    await page.goto('/settings');

    // Navigate to the Account tab
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId('account-duplicates-section')).toBeVisible({ timeout: 5000 });
  });

  // ─── No duplicates ──────────────────────────────────────────────────────────

  test('shows "No duplicate accounts detected" when API returns empty array', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [] }),
      });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId('account-duplicates-none')).toBeVisible({ timeout: 5000 });
    const text = await page.getByTestId('account-duplicates-none').textContent();
    expect(text).toMatch(/no duplicate/i);
  });

  // ─── Duplicate found ────────────────────────────────────────────────────────

  test('shows duplicate account row with Merge button when API returns a duplicate', async ({
    page,
  }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [DUP_A] }),
      });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId(`account-duplicate-row-${DUP_A.id}`)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId(`account-merge-btn-${DUP_A.id}`)).toBeVisible();

    const rowText = await page.getByTestId(`account-duplicate-row-${DUP_A.id}`).textContent();
    expect(rowText).toContain(DUP_A.email);
  });

  test('shows multiple duplicate rows when API returns several', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [DUP_A, DUP_B] }),
      });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId(`account-duplicate-row-${DUP_A.id}`)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId(`account-duplicate-row-${DUP_B.id}`)).toBeVisible();
  });

  // ─── Merge dialog ───────────────────────────────────────────────────────────

  test('clicking Merge button opens confirmation dialog', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [DUP_A] }),
      });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId(`account-merge-btn-${DUP_A.id}`)).toBeVisible({ timeout: 5000 });
    await page.getByTestId(`account-merge-btn-${DUP_A.id}`).click();

    await expect(page.getByTestId('account-merge-dialog')).toBeVisible();
    const dialogText = await page.getByTestId('account-merge-dialog').textContent();
    expect(dialogText).toContain(DUP_A.email);
  });

  test('Cancel button closes the confirmation dialog without merging', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [DUP_A] }),
      });
    });

    let mergeCalled = false;
    await page.route('**/api/account/merge', async (route) => {
      mergeCalled = true;
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId(`account-merge-btn-${DUP_A.id}`)).toBeVisible({ timeout: 5000 });
    await page.getByTestId(`account-merge-btn-${DUP_A.id}`).click();
    await expect(page.getByTestId('account-merge-dialog')).toBeVisible();

    await page.getByTestId('account-merge-cancel').click();

    await expect(page.getByTestId('account-merge-dialog')).toHaveCount(0);
    expect(mergeCalled).toBe(false);
    // Duplicate row should still be present
    await expect(page.getByTestId(`account-duplicate-row-${DUP_A.id}`)).toBeVisible();
  });

  // ─── Successful merge ────────────────────────────────────────────────────────

  test('confirming merge calls POST /api/account/merge with correct body', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [DUP_A] }),
      });
    });

    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/api/account/merge', async (route) => {
      capturedBody = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          moved_messages: 3,
          moved_kb: 1,
          moved_drafts: 2,
          moved_tokens: 1,
        }),
      });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId(`account-merge-btn-${DUP_A.id}`)).toBeVisible({ timeout: 5000 });
    await page.getByTestId(`account-merge-btn-${DUP_A.id}`).click();
    await page.getByTestId('account-merge-confirm').click();

    // Wait for dialog to close
    await expect(page.getByTestId('account-merge-dialog')).toHaveCount(0, { timeout: 5000 });

    expect(capturedBody).toMatchObject({ duplicate_user_id: DUP_A.id });
  });

  test('after successful merge, the duplicate row is removed from the list', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [DUP_A, DUP_B] }),
      });
    });

    await page.route('**/api/account/merge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, moved_messages: 0, moved_kb: 0, moved_drafts: 0, moved_tokens: 0 }),
      });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId(`account-merge-btn-${DUP_A.id}`)).toBeVisible({ timeout: 5000 });
    await page.getByTestId(`account-merge-btn-${DUP_A.id}`).click();
    await page.getByTestId('account-merge-confirm').click();

    // DUP_A row should be gone; DUP_B should remain
    await expect(page.getByTestId(`account-duplicate-row-${DUP_A.id}`)).toHaveCount(0, {
      timeout: 5000,
    });
    await expect(page.getByTestId(`account-duplicate-row-${DUP_B.id}`)).toBeVisible();
  });

  test('shows success message after merge', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [DUP_A] }),
      });
    });

    await page.route('**/api/account/merge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, moved_messages: 5, moved_kb: 2, moved_drafts: 1, moved_tokens: 1 }),
      });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId(`account-merge-btn-${DUP_A.id}`)).toBeVisible({ timeout: 5000 });
    await page.getByTestId(`account-merge-btn-${DUP_A.id}`).click();
    await page.getByTestId('account-merge-confirm').click();

    await expect(page.getByTestId('account-merge-success')).toBeVisible({ timeout: 5000 });
    const msg = await page.getByTestId('account-merge-success').textContent();
    expect(msg).toMatch(/merged/i);
  });

  // ─── Error states ────────────────────────────────────────────────────────────

  test('shows friendly error when duplicates API returns 500', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId('account-duplicates-error')).toBeVisible({ timeout: 5000 });
    const text = await page.getByTestId('account-duplicates-error').textContent();
    expect(text).not.toMatch(/\b500\b/);
    expect(text).toMatch(/couldn.t check|duplicate|refresh/i);
  });

  test('shows friendly error when merge API returns 500', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [DUP_A] }),
      });
    });

    await page.route('**/api/account/merge', async (route) => {
      await route.fulfill({ status: 500, body: JSON.stringify({ error: 'db_error' }) });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId(`account-merge-btn-${DUP_A.id}`)).toBeVisible({ timeout: 5000 });
    await page.getByTestId(`account-merge-btn-${DUP_A.id}`).click();
    await page.getByTestId('account-merge-confirm').click();

    await expect(page.getByTestId('account-merge-error')).toBeVisible({ timeout: 5000 });
    const text = await page.getByTestId('account-merge-error').textContent();
    expect(text).toMatch(/couldn.t merge|try again/i);
  });

  test('error message is rendered as an alert', async ({ page }) => {
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({ status: 503, body: 'Service Unavailable' });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    const alert = page.getByRole('alert').filter({ hasText: /couldn.t check|duplicate/i });
    await expect(alert).toBeVisible({ timeout: 5000 });
  });

  // ─── No horizontal overflow at mobile ────────────────────────────────────────

  test('Duplicate Accounts section does not overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockSettingsDeps(page);
    await page.route('**/api/account/duplicates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duplicates: [DUP_A] }),
      });
    });

    await page.goto('/settings');
    await page.getByRole('tab', { name: /account/i }).click();

    await expect(page.getByTestId('account-duplicates-section')).toBeVisible({ timeout: 5000 });
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
