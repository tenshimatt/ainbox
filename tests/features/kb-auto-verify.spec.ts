/**
 * TASK7544-22 — Kill /onboarding/kb-review from critical path; auto-verify top items.
 *
 * Acceptance criteria:
 * - POST /api/kb/auto-verify endpoint exists and rejects unauthenticated callers (401)
 * - /onboarding/sync CTA links to /inbox (not /onboarding/kb-review) when sync completes
 * - /onboarding/sync calls POST /api/kb/auto-verify after sync completes
 * - "Continue to Knowledge Review" link is absent when sync is done
 */

import { test, expect } from '@playwright/test';

test.describe('@feature TASK7544-22 kb auto-verify', () => {
  test('POST /api/kb/auto-verify exists — unauthenticated returns 401 not 404', async ({ request }) => {
    const resp = await request.post('/api/kb/auto-verify');
    // 401 = endpoint exists but requires auth. 404/405 would mean it doesn't exist.
    expect(resp.status()).toBe(401);
  });

  test('sync page CTA links to /inbox (not kb-review) when sync completes', async ({ page }) => {
    await page.route('/api/sync/gmail', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }),
    );
    await page.route('/api/sync/outlook', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }),
    );
    // Return a stable count so 3 stable ticks accumulate quickly
    let callCount = 0;
    await page.route('/api/sync/status', (route) => {
      callCount++;
      // First call bumps count so lastCount is set; subsequent calls stay stable
      const synced = callCount === 1 ? 10 : 10;
      route.fulfill({
        status: 200,
        body: JSON.stringify({ counts: { synced, classified: 4, drafts: 1, kb: 2 } }),
      });
    });
    await page.route('/api/kb/auto-verify', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, verified: 2 }) }),
    );

    await page.goto('/onboarding/sync');

    const cta = page.getByRole('link', { name: 'Go to inbox' });
    await expect(cta).toBeVisible({ timeout: 30_000 });
    await expect(cta).toHaveAttribute('href', '/inbox');
  });

  test('"Continue to Knowledge Review" is absent when sync completes', async ({ page }) => {
    await page.route('/api/sync/gmail', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }),
    );
    await page.route('/api/sync/outlook', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }),
    );
    await page.route('/api/sync/status', (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({ counts: { synced: 10, classified: 4, drafts: 1, kb: 2 } }),
      }),
    );
    await page.route('/api/kb/auto-verify', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, verified: 2 }) }),
    );

    await page.goto('/onboarding/sync');

    // Wait for the new CTA to appear
    await page.getByRole('link', { name: 'Go to inbox' }).waitFor({ timeout: 30_000 });

    // The old "Continue to Knowledge Review" link must not be in the DOM
    await expect(page.getByRole('link', { name: /knowledge review/i })).not.toBeVisible();
  });

  test('sync page fires POST /api/kb/auto-verify after sync completes', async ({ page }) => {
    await page.route('/api/sync/gmail', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }),
    );
    await page.route('/api/sync/outlook', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }),
    );
    await page.route('/api/sync/status', (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({ counts: { synced: 8, classified: 3, drafts: 0, kb: 1 } }),
      }),
    );

    let autoVerifyCalled = false;
    await page.route('/api/kb/auto-verify', (route) => {
      autoVerifyCalled = true;
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, verified: 1 }) });
    });

    await page.goto('/onboarding/sync');

    // Wait for sync complete state
    await page.getByRole('link', { name: 'Go to inbox' }).waitFor({ timeout: 30_000 });

    expect(autoVerifyCalled).toBe(true);
  });
});
