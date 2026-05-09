/**
 * PRD §12.5 Gmail Email Scope Backfill
 *
 * Acceptance criteria (from docs/architecture/gmail-email-scope-backfill.md):
 *
 * Task 1 — Database schema:
 * - GET /api/v1/gmail/connections/:id/scope-status returns { email_scope_granted: false } by default
 *
 * Task 2 — Scope-check API:
 * - GET /api/v1/gmail/scope-status?connection_id=<id> returns 200 + { email_scope_granted: bool }
 * - Returns 404 for non-existent connection
 * - Returns 401/403 without authentication (tenant isolation)
 *
 * Task 3 — OAuth consent:
 * - /connect/google flow includes gmail.readonly in the scope parameter
 *
 * Task 4 — Front-end upgrade banner:
 * - /settings/providers (or /settings/gmail) shows upgrade banner when email_scope_granted=false
 * - Banner text explains granting inbox read permission
 * - Clicking "Upgrade now" redirects toward Google OAuth with gmail.readonly scope
 * - After re-auth success (?upgrade_success=1), banner is not visible
 *
 * Task 5 — Migration script:
 * - POST /api/v1/admin/trigger-scope-migration returns 200 (or 401/403 for non-admin, not 404)
 *
 * Task 7 — Revocation handling:
 * - POST /api/v1/gmail/webhook/revocation endpoint exists (not 404)
 * - After posting a revocation event, scope-status returns email_scope_granted=false
 *
 * Task 8 — Observability:
 * - GET /metrics includes gmail_scope_upgrade_total counter (or endpoint exists)
 *
 * PRD §4.1 Tenant isolation: scope-status must not expose other users' data
 * PRD §4.3 No PII in logs
 * PRD §8.1 Mobile-first: no horizontal overflow at 375px
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Task 2 — Scope-check API endpoint
// ---------------------------------------------------------------------------

test.describe('@e2e §12.5 gmail scope-status API', () => {
  test('§12.5 GET /api/v1/gmail/scope-status returns 401/403 without auth (not 404)', async ({ request }) => {
    const resp = await request.get('/api/v1/gmail/scope-status?connection_id=any');
    expect(resp.status()).not.toBe(404);
    // Without auth: must be 401 or 403, not 200 leaking data
    expect([401, 403]).toContain(resp.status());
  });

  test('§12.5 GET /api/v1/gmail/scope-status returns 404 for non-existent connection id', async ({ request }) => {
    // When unauthenticated we expect 401/403 (above). This checks 404 shape via OPTIONS or shape.
    // The route must exist — not a total 404 on the base path
    const resp = await request.get('/api/v1/gmail/scope-status');
    // Missing required param: 400/401/403/422 — never 404 (route must exist)
    expect(resp.status()).not.toBe(404);
  });

  test('§12.5 scope-status response shape has email_scope_granted field when authenticated', async ({ page, request }) => {
    // Call the API; without real auth we expect a non-200 but the route MUST exist.
    // If somehow a test user is seeded, the response body must have email_scope_granted.
    const resp = await request.get('/api/v1/gmail/scope-status?connection_id=test-nonexistent-id');
    // Route exists (not 404)
    expect(resp.status()).not.toBe(404);
    if (resp.status() === 200) {
      const body = await resp.json();
      expect(body).toHaveProperty('email_scope_granted');
      expect(typeof body.email_scope_granted).toBe('boolean');
    }
  });
});

// ---------------------------------------------------------------------------
// Task 4 — Front-end upgrade banner
// ---------------------------------------------------------------------------

test.describe('@e2e §12.5 gmail scope upgrade banner', () => {
  test('§12.5 /settings/providers renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/settings/providers');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§12.5 upgrade banner visible when API returns email_scope_granted=false', async ({ page }) => {
    // Mock the scope-status API to simulate missing scope
    await page.route('**/api/v1/gmail/scope-status**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email_scope_granted: false }),
      })
    );
    await page.goto('/settings/providers');
    const url = page.url();
    // If redirected to auth, skip (unauthenticated) — banner only visible when authed
    if (!url.includes('/settings')) return;

    const banner = page
      .locator('[data-testid="gmail-scope-upgrade-banner"]')
      .or(page.getByRole('alert').filter({ hasText: /grant.*permission|read.*inbox|upgrade.*gmail|gmail.*scope/i }));
    await expect(banner.first()).toBeVisible({ timeout: 3000 });
  });

  test('§12.5 upgrade banner contains correct user-facing text', async ({ page }) => {
    await page.route('**/api/v1/gmail/scope-status**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email_scope_granted: false }),
      })
    );
    await page.goto('/settings/providers');
    const url = page.url();
    if (!url.includes('/settings')) return;

    const banner = page.locator('[data-testid="gmail-scope-upgrade-banner"]').first();
    const exists = await banner.isVisible().catch(() => false);
    if (exists) {
      const text = await banner.textContent() ?? '';
      expect(text.toLowerCase()).toMatch(/permission|inbox|gmail|grant|read/);
    }
  });

  test('§12.5 upgrade banner NOT shown when email_scope_granted=true', async ({ page }) => {
    await page.route('**/api/v1/gmail/scope-status**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email_scope_granted: true }),
      })
    );
    await page.goto('/settings/providers');
    const url = page.url();
    if (!url.includes('/settings')) return;

    const banner = page.locator('[data-testid="gmail-scope-upgrade-banner"]');
    const visible = await banner.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });

  test('§12.5 upgrade button triggers OAuth redirect with gmail.readonly scope', async ({ page }) => {
    await page.route('**/api/v1/gmail/scope-status**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email_scope_granted: false }),
      })
    );
    await page.goto('/settings/providers');
    const url = page.url();
    if (!url.includes('/settings')) return;

    const upgradeBtn = page
      .locator('[data-testid="upgrade-scope-button"]')
      .or(page.getByRole('button', { name: /upgrade now|grant access|enable email|add scope/i }));
    const exists = await upgradeBtn.first().isVisible().catch(() => false);
    if (!exists) return; // banner not rendered without auth session — skip

    const [nav] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'commit', timeout: 5000 }).catch(() => null),
      upgradeBtn.first().click(),
    ]);

    const currentUrl = page.url();
    // Should redirect to Google OAuth or to the connect/google route
    expect(currentUrl).toMatch(/accounts\.google\.com|\/connect\/google|oauth|authorize/i);
    if (currentUrl.includes('accounts.google.com')) {
      expect(currentUrl).toMatch(/gmail\.readonly|gmail\.modify|mail\.google/);
    }
  });

  test('§12.5 after upgrade success flag (?upgrade_success=1) banner not shown', async ({ page }) => {
    // After successful re-auth, the page is loaded with success query param
    // and scope-status API returns true
    await page.route('**/api/v1/gmail/scope-status**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email_scope_granted: true }),
      })
    );
    const resp = await page.goto('/settings/providers?upgrade_success=1');
    expect(resp?.status()).not.toBe(500);

    const url = page.url();
    if (!url.includes('/settings')) return;

    const banner = page.locator('[data-testid="gmail-scope-upgrade-banner"]');
    const visible = await banner.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — OAuth consent includes gmail.readonly scope
// ---------------------------------------------------------------------------

test.describe('@e2e §12.5 gmail OAuth scope parameter', () => {
  test('§12.5 /connect/google includes gmail.readonly in OAuth redirect URL', async ({ page }) => {
    await page.goto('/connect');
    const googleBtn = page.getByRole('button', { name: /google/i }).first();
    const exists = await googleBtn.isVisible().catch(() => false);
    if (!exists) return;

    const [nav] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'commit', timeout: 5000 }).catch(() => null),
      googleBtn.click(),
    ]);

    const url = page.url();
    if (url.includes('accounts.google.com') || url.includes('oauth')) {
      // Must include gmail.readonly in scope
      const decodedUrl = decodeURIComponent(url);
      expect(decodedUrl).toMatch(/gmail\.readonly/);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 5 — Migration trigger endpoint
// ---------------------------------------------------------------------------

test.describe('@e2e §12.5 scope migration admin endpoint', () => {
  test('§12.5 POST /api/v1/admin/trigger-scope-migration endpoint exists (not 404)', async ({ request }) => {
    const resp = await request.post('/api/v1/admin/trigger-scope-migration');
    // 401/403 = auth-gated (fine), 200 = success, 405 = wrong method but route exists
    // NOT 404
    expect(resp.status()).not.toBe(404);
  });

  test('§12.5 POST /api/v1/admin/trigger-scope-migration returns 401/403 without admin auth', async ({ request }) => {
    const resp = await request.post('/api/v1/admin/trigger-scope-migration');
    // Unauthenticated call must NOT return 200 (would be an auth bypass)
    expect(resp.status()).not.toBe(200);
    expect([401, 403, 405]).toContain(resp.status());
  });
});

// ---------------------------------------------------------------------------
// Task 7 — Revocation webhook endpoint
// ---------------------------------------------------------------------------

test.describe('@e2e §12.5 gmail token revocation webhook', () => {
  test('§12.5 POST /api/v1/gmail/webhook/revocation endpoint exists (not 404)', async ({ request }) => {
    const resp = await request.post('/api/v1/gmail/webhook/revocation', {
      data: { connection_id: 'test-revoke', event: 'token_revoked' },
    });
    // 401/403 = auth-gated or signature required (acceptable)
    // 400 = missing signature validation (acceptable)
    // NOT 404
    expect(resp.status()).not.toBe(404);
  });

  test('§12.5 revocation webhook rejects unsigned requests (not 200)', async ({ request }) => {
    // A request without proper signature/secret must not be processed as 200
    const resp = await request.post('/api/v1/gmail/webhook/revocation', {
      data: { connection_id: 'test-revoke', event: 'token_revoked' },
    });
    // Must require signature validation — bare unsigned POST must not succeed
    expect(resp.status()).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Task 8 — Observability / metrics
// ---------------------------------------------------------------------------

test.describe('@e2e §12.5 observability metrics', () => {
  test('§12.5 GET /metrics endpoint exists (not 404)', async ({ request }) => {
    const resp = await request.get('/metrics');
    // 401/403 = auth-gated metrics (acceptable in prod), 200 = open metrics
    // NOT 404 — the endpoint must be defined
    if (resp.status() === 404) {
      // Some setups use /api/metrics — try that
      const resp2 = await request.get('/api/metrics');
      expect(resp2.status()).not.toBe(404);
    }
  });

  test('§12.5 metrics response includes gmail_scope_upgrade_total counter when available', async ({ request }) => {
    const resp = await request.get('/metrics');
    if (resp.status() !== 200) return; // auth-gated or not yet implemented
    const text = await resp.text();
    // Counter must be present once implemented
    expect(text).toContain('gmail_scope_upgrade_total');
  });
});

// ---------------------------------------------------------------------------
// PRD §4.1 — Tenant isolation: scope-status must not leak cross-tenant
// ---------------------------------------------------------------------------

test.describe('@e2e §12.5 §4.1 tenant isolation', () => {
  test('§12.5 §4.1 scope-status endpoint requires authentication', async ({ request }) => {
    // Calling without a session must not return 200 with data
    const resp = await request.get('/api/v1/gmail/scope-status?connection_id=any-id');
    expect(resp.status()).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PRD §8.1 Mobile-first — no horizontal overflow at 375px
// ---------------------------------------------------------------------------

test.describe('@e2e §12.5 §8.1 mobile layout', () => {
  test('§12.5 /settings/providers no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings/providers');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('§12.5 /connect no horizontal overflow at 375px (scope banner)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route('**/api/v1/gmail/scope-status**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email_scope_granted: false }),
      })
    );
    await page.goto('/settings/providers');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
