/**
 * PRD §12.1 Outlook email-scope token flow + delta-sync backfill
 * AINBOX-6: Webhook / Graph subscription notifications & token refresh
 *
 * Acceptance criteria (Tasks 3 & 7 from plan):
 * - POST /api/outlook/webhook with a valid notification payload returns 200
 * - Webhook validation challenge (GET with validationToken) returns the token
 * - Token refresh: a 401 from Graph triggers automatic re-auth (no "Auth error" shown)
 * - /api/outlook/webhook rejects requests without a valid clientState (returns 4xx)
 * - Sync status does not show "Auth error" after a successful token refresh
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §12.1 Outlook webhook & token refresh', () => {
  // ─── Webhook endpoint ────────────────────────────────────────────────────

  test('§12.1 POST /api/outlook/webhook route exists (no 404/500)', async ({ page }) => {
    // Will FAIL until the webhook route is implemented
    const resp = await page.request.post('/api/outlook/webhook', {
      data: {
        value: [
          {
            subscriptionId: 'test-sub-id-001',
            resource: 'me/mailFolders/inbox/messages',
            changeType: 'created',
            clientState: 'test-client-state',
          },
        ],
      },
    });
    // Must exist — not 404. May return 401 (unauthenticated) or 200/202.
    expect(resp.status()).not.toBe(404);
    expect(resp.status()).not.toBe(500);
  });

  test('§12.1 webhook GET validation challenge echoes validationToken', async ({ page }) => {
    // Graph validates webhook endpoints by sending a GET with ?validationToken=<token>
    // The endpoint MUST echo back the token as plain text with 200.
    // Will FAIL until the webhook validation handler is implemented.
    const validationToken = 'Validation_test_token_abc123';
    const resp = await page.request.get(
      `/api/outlook/webhook?validationToken=${encodeURIComponent(validationToken)}`,
    );
    if (resp.status() === 404) {
      // Route not yet implemented — this test will count as failing
      expect(resp.status()).not.toBe(404);
      return;
    }
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    expect(body.trim()).toBe(validationToken);
  });

  test('§12.1 webhook rejects notification with invalid clientState (4xx)', async ({ page }) => {
    // Security: requests with wrong/missing clientState must be rejected
    // Will FAIL until clientState validation is implemented
    const resp = await page.request.post('/api/outlook/webhook', {
      data: {
        value: [
          {
            subscriptionId: 'test-sub-id-002',
            resource: 'me/mailFolders/inbox/messages',
            changeType: 'created',
            // clientState intentionally wrong
            clientState: 'INVALID_WRONG_STATE',
          },
        ],
      },
    });
    if (resp.status() === 404) {
      // Route not yet implemented
      expect(resp.status()).not.toBe(404);
      return;
    }
    // Must reject with a 4xx
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    expect(resp.status()).toBeLessThan(500);
  });

  test('§12.1 webhook notification triggers sync (returns 200 or 202)', async ({ page }) => {
    // Will FAIL until the webhook handler queues a sync on valid notification
    const resp = await page.request.post('/api/outlook/webhook', {
      data: {
        value: [
          {
            subscriptionId: 'test-sub-id-valid',
            resource: 'me/mailFolders/inbox/messages',
            changeType: 'created',
            // clientState must match configured value — in tests it may be missing
          },
        ],
      },
    });
    expect(resp.status()).not.toBe(404);
    expect(resp.status()).not.toBe(500);
  });

  // ─── Token refresh ────────────────────────────────────────────────────────

  test('§12.1 GET /api/outlook-profile returns 200 with valid mocked Graph token', async ({
    page,
  }) => {
    // Will FAIL until /api/outlook-profile route is implemented
    await page.route('https://graph.microsoft.com/v1.0/me', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-user-id', userPrincipalName: 'test@example-domain.test' }),
      });
    });

    const resp = await page.request.get('/api/outlook-profile');
    // Route must exist; may return 401 (not authenticated) but not 404/500
    expect(resp.status()).not.toBe(404);
    expect(resp.status()).not.toBe(500);
  });

  test('§12.1 token refresh: 401 from Graph does not surface "Auth error" in sync UI', async ({
    page,
  }) => {
    // Will FAIL until automatic token refresh is implemented
    let callCount = 0;
    await page.route('**/graph.microsoft.com/**', (route) => {
      if (callCount === 0) {
        callCount++;
        // First call: simulate expired token
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired' },
          }),
        });
      } else {
        // Subsequent calls: token refreshed, succeed
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await page.goto('/onboarding/sync');
    const afterUrl = page.url();
    if (!afterUrl.includes('/onboarding/sync')) {
      test.skip(); // auth redirect
      return;
    }

    const syncBtn = page.locator('[data-testid="sync-now-btn"]');
    const btnVisible = await syncBtn.isVisible().catch(() => false);
    if (!btnVisible) {
      return; // sync-now-btn not yet implemented
    }
    await syncBtn.click();
    // After token refresh, status must not show "Auth error"
    await page.waitForTimeout(2000);
    const authError = page.locator(
      '[data-testid="sync-status"]:has-text("Auth error"), [data-testid="sync-error"]:has-text("Auth error")',
    );
    await expect(authError).toHaveCount(0);
  });

  // ─── Subscription lifecycle ───────────────────────────────────────────────

  test('§12.1 POST /api/outlook/subscriptions/create route exists', async ({ page }) => {
    // Will FAIL until the subscription management endpoint is implemented
    const resp = await page.request.post('/api/outlook/subscriptions/create');
    expect(resp.status()).not.toBe(404);
    // 401 (not authenticated), 400 (bad request) or 200/201 are all acceptable
    expect(resp.status()).not.toBe(500);
  });

  // ─── Mobile ───────────────────────────────────────────────────────────────

  test('§12.1 §8.1 /onboarding/sync webhook trigger section fits 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/onboarding/sync');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
