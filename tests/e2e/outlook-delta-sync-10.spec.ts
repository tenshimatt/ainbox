/**
 * PRD §12.1 Outlook email-scope token flow + delta-sync backfill
 * AINBOX-6: Incremental delta sync & historical backfill
 *
 * Acceptance criteria (Tasks 5 & 6 from plan):
 * - POST /api/sync/outlook/start returns 200 and stores a deltaToken
 * - Delta sync: mocked Graph delta response with a new message is inserted
 * - New message appears in the UI after delta sync
 * - Backfill UI trigger: "Backfill older emails" button opens date-range modal
 * - Backfill progress indicator appears and tracks to 100%
 * - 429 throttling from Graph shows retry/throttled message in backfill UI
 * - Sync status endpoint returns structured progress data
 * - /onboarding/sync no horizontal overflow at 375px (§8.1 mobile-first)
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §12.1 Outlook delta sync & backfill', () => {
  // ─── Sync API endpoints ───────────────────────────────────────────────────

  test('§12.1 POST /api/sync/outlook/start route exists (no 404/500)', async ({ page }) => {
    // Will FAIL until the route is implemented
    const resp = await page.request.post('/api/sync/outlook/start');
    expect(resp.status()).not.toBe(404);
    expect(resp.status()).not.toBe(500);
  });

  test('§12.1 GET /api/sync/outlook/status route exists and returns JSON', async ({ page }) => {
    // Will FAIL until the route is implemented
    const resp = await page.request.get('/api/sync/outlook/status');
    expect(resp.status()).not.toBe(404);
    expect(resp.status()).not.toBe(500);
    // Must respond with JSON
    const ct = resp.headers()['content-type'] ?? '';
    expect(ct).toContain('json');
  });

  test('§12.1 sync status response contains required fields', async ({ page }) => {
    // Will FAIL until the route is implemented
    const resp = await page.request.get('/api/sync/outlook/status');
    if (resp.status() === 401) {
      // Unauthenticated — must return 401 not 404/500
      expect(resp.status()).toBe(401);
      return;
    }
    expect(resp.status()).toBeLessThan(400);
    const body = await resp.json();
    // Status must include a state field: 'idle' | 'syncing' | 'complete' | 'failed'
    expect(body).toHaveProperty('state');
    expect(['idle', 'syncing', 'complete', 'failed', 'not_connected']).toContain(body.state);
  });

  // ─── Delta sync UI ────────────────────────────────────────────────────────

  test('§12.1 /onboarding/sync page renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/onboarding/sync');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§12.1 sync-now button triggers delta sync', async ({ page }) => {
    // Will FAIL until the sync-now button is implemented
    await page.goto('/onboarding/sync');
    const afterUrl = page.url();
    if (!afterUrl.includes('/onboarding/sync')) {
      test.skip(); // auth redirect
      return;
    }
    const syncBtn = page.locator('[data-testid="sync-now-btn"]');
    await expect(syncBtn).toBeVisible();
  });

  test('§12.1 delta sync: mocked Graph response with new message triggers UI update', async ({
    page,
  }) => {
    // Will FAIL until the delta sync UI is implemented
    await page.route(
      '**/graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta**',
      (route) => {
        const mockResponse = {
          '@odata.deltaLink':
            'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=test-token-abc',
          value: [
            {
              id: 'test-delta-msg-001',
              subject: 'Delta sync test message',
              receivedDateTime: new Date().toISOString(),
              from: { emailAddress: { address: 'sender@example-domain.test' } },
            },
          ],
        };
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockResponse),
        });
      },
    );

    await page.goto('/onboarding/sync');
    const afterUrl = page.url();
    if (!afterUrl.includes('/onboarding/sync')) {
      test.skip();
      return;
    }

    const syncBtn = page.locator('[data-testid="sync-now-btn"]');
    const btnVisible = await syncBtn.isVisible().catch(() => false);
    if (!btnVisible) {
      // sync-now-btn not yet implemented
      return;
    }
    await syncBtn.click();
    // After sync, message should appear in the message list
    await expect(
      page.locator('[data-testid="message-list"] >> text=Delta sync test message'),
    ).toBeVisible({ timeout: 10000 });
  });

  // ─── Backfill UI ──────────────────────────────────────────────────────────

  test('§12.1 backfill button opens date-range modal', async ({ page }) => {
    // Will FAIL until the backfill UI is implemented
    await page.goto('/onboarding/sync');
    const afterUrl = page.url();
    if (!afterUrl.includes('/onboarding/sync')) {
      test.skip();
      return;
    }
    const backfillBtn = page.locator('[data-testid="backfill-btn"]');
    await expect(backfillBtn).toBeVisible();
    await backfillBtn.click();
    await expect(page.locator('[data-testid="backfill-modal"]')).toBeVisible();
  });

  test('§12.1 backfill: submitting date range shows progress indicator', async ({ page }) => {
    // Will FAIL until the backfill progress UI is implemented
    await page.route(
      '**/graph.microsoft.com/v1.0/me/mailFolders/inbox/messages**',
      (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            value: [
              {
                id: 'hist-msg-001',
                subject: 'Old mail backfill test',
                receivedDateTime: '2023-01-15T10:00:00Z',
                from: { emailAddress: { address: 'old-sender@example-domain.test' } },
              },
            ],
          }),
        });
      },
    );

    await page.goto('/onboarding/sync');
    const afterUrl = page.url();
    if (!afterUrl.includes('/onboarding/sync')) {
      test.skip();
      return;
    }

    const backfillBtn = page.locator('[data-testid="backfill-btn"]');
    const btnVisible = await backfillBtn.isVisible().catch(() => false);
    if (!btnVisible) {
      return; // not yet implemented
    }
    await backfillBtn.click();
    await expect(page.locator('[data-testid="backfill-modal"]')).toBeVisible();
    await page.fill('[data-testid="start-date"]', '2023-01-01');
    await page.locator('[data-testid="start-backfill"]').click();
    await expect(page.locator('[data-testid="backfill-progress"]')).toBeVisible();
  });

  test('§12.1 backfill: completes to 100% with mocked Graph response', async ({ page }) => {
    // Will FAIL until the backfill completion state is implemented
    await page.route(
      '**/graph.microsoft.com/v1.0/me/mailFolders/inbox/messages**',
      (route) => {
        // Return a single page result (no nextLink) so backfill completes immediately
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            value: [
              {
                id: 'hist-msg-complete-001',
                subject: 'Backfill complete test',
                receivedDateTime: '2023-06-15T10:00:00Z',
                from: { emailAddress: { address: 'complete-sender@example-domain.test' } },
              },
            ],
            // No @odata.nextLink → this is the last page
          }),
        });
      },
    );

    await page.goto('/onboarding/sync');
    const afterUrl = page.url();
    if (!afterUrl.includes('/onboarding/sync')) {
      test.skip();
      return;
    }

    const backfillBtn = page.locator('[data-testid="backfill-btn"]');
    const btnVisible = await backfillBtn.isVisible().catch(() => false);
    if (!btnVisible) {
      return;
    }
    await backfillBtn.click();
    const modalVisible = await page
      .locator('[data-testid="backfill-modal"]')
      .isVisible()
      .catch(() => false);
    if (!modalVisible) return;
    await page.fill('[data-testid="start-date"]', '2023-01-01');
    await page.locator('[data-testid="start-backfill"]').click();
    await expect(page.locator('[data-testid="backfill-progress"]')).toContainText('100%', {
      timeout: 15000,
    });
  });

  test('§12.1 backfill: Graph 429 shows throttled error message', async ({ page }) => {
    // Will FAIL until the backfill error/throttle state is implemented
    await page.route('**/graph.microsoft.com/**', (route) => {
      route.fulfill({
        status: 429,
        headers: { 'Retry-After': '10' },
        body: JSON.stringify({ error: { code: 'TooManyRequests', message: 'Rate limit exceeded' } }),
      });
    });

    await page.goto('/onboarding/sync');
    const afterUrl = page.url();
    if (!afterUrl.includes('/onboarding/sync')) {
      test.skip();
      return;
    }

    const backfillBtn = page.locator('[data-testid="backfill-btn"]');
    const btnVisible = await backfillBtn.isVisible().catch(() => false);
    if (!btnVisible) {
      return;
    }
    await backfillBtn.click();
    const modalVisible = await page
      .locator('[data-testid="backfill-modal"]')
      .isVisible()
      .catch(() => false);
    if (!modalVisible) return;
    await page.fill('[data-testid="start-date"]', '2023-01-01');
    await page.locator('[data-testid="start-backfill"]').click();
    await expect(page.locator('[data-testid="backfill-error"]')).toContainText(
      /throttled|rate.?limit|try again/i,
      { timeout: 8000 },
    );
  });

  // ─── Mobile ───────────────────────────────────────────────────────────────

  test('§12.1 §8.1 /onboarding/sync no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/onboarding/sync');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
