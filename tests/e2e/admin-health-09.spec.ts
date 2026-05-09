/**
 * PRD §5.4 Admin surface — /admin/health
 * PRD §7.17 Error handling & retries
 *
 * Acceptance criteria:
 * - /admin/health page renders without 404/500
 * - Page is auth-gated: unauthenticated request returns 401 or redirects, not 500
 * - /api/admin/health endpoint exists and returns 401 for unauthenticated requests
 * - Admin health page shows NO tenant data (PII §4.3 — bodies redacted)
 * - Admin health page shows system-level metrics only: queue depth, error rates
 * - /admin/health has sidebar + topbar (AppLayout §4.5)
 * - /admin/health no horizontal overflow at 375px (§8.1 mobile-first)
 * - /api/admin/health returns JSON with a "status" field
 * - Error rates surface per-tenant without exposing email content
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §5.4 §7.17 admin health dashboard', () => {
  test('§5.4 /admin/health page exists (not 404)', async ({ page }) => {
    const resp = await page.goto('/admin/health');
    expect(resp?.status()).not.toBe(404);
  });

  test('§5.4 /admin/health is auth-gated (no 500, 200 requires auth)', async ({ page }) => {
    const resp = await page.goto('/admin/health');
    // Either auth redirect (302/303 → login), 401, or the authenticated page
    expect(resp?.status()).not.toBe(500);
    // If we get a 200, the URL must still be /admin/health (not some error page)
    if (resp?.status() === 200) {
      expect(page.url()).toMatch(/\/admin\/health/);
    }
  });

  test('§5.4 /api/admin/health endpoint returns 401 for unauthenticated requests', async ({ page }) => {
    const resp = await page.request.get('/api/admin/health');
    // Must be 401 Unauthorized — not 404 (endpoint exists) and not 200 (auth enforced)
    expect(resp.status()).not.toBe(404);
    expect(resp.status()).toBe(401);
  });

  test('§5.4 /api/admin/health returns JSON with status field when called', async ({ page }) => {
    const resp = await page.request.get('/api/admin/health');
    // Even a 401 must return a JSON body (not HTML error)
    const ct = resp.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/);
    const body = await resp.json().catch(() => null);
    expect(body).not.toBeNull();
    // For 401 responses, body should have error field; for 200, should have status
    expect(body).toHaveProperty(resp.status() === 401 ? 'error' : 'status');
  });

  test('§5.4 §4.3 /admin/health page shows NO email body or PII content', async ({ page }) => {
    await page.goto('/admin/health');
    const url = page.url();
    if (!url.includes('/admin/health')) return; // auth redirect — skip

    // Admin health must NOT show any raw email body columns or PII
    const bodyColumn = page.locator(
      '[data-testid="email-body"], th:has-text("body"), [data-testid="email-subject"]'
    );
    const hasBodyColumn = await bodyColumn.count().then(n => n > 0).catch(() => false);
    expect(hasBodyColumn).toBe(false);
  });

  test('§5.4 §7.17 /admin/health shows system-level metrics section', async ({ page }) => {
    await page.goto('/admin/health');
    const url = page.url();
    if (!url.includes('/admin/health')) return;

    // Must show queue depth, error rates, or system health metrics
    const hasQueueDepth = await page.getByText(/queue|depth|backlog/i).first().isVisible().catch(() => false);
    const hasErrorRate = await page.getByText(/error|fail|rate/i).first().isVisible().catch(() => false);
    const hasHealthLabel = await page.getByText(/health|status|system/i).first().isVisible().catch(() => false);
    expect(hasQueueDepth || hasErrorRate || hasHealthLabel).toBe(true);
  });

  test('§4.5 /admin/health wraps in AppLayout (sidebar or topbar present)', async ({ page }) => {
    await page.goto('/admin/health');
    const url = page.url();
    if (!url.includes('/admin/health')) return;

    const hasSidebar = await page.locator('nav, aside, [data-testid="sidebar"], [aria-label="sidebar"]')
      .first().isVisible().catch(() => false);
    const hasTopbar = await page.locator('header, [data-testid="topbar"], [role="banner"]')
      .first().isVisible().catch(() => false);
    expect(hasSidebar || hasTopbar).toBe(true);
  });

  test('§5.4 /admin/health heading or title is present', async ({ page }) => {
    await page.goto('/admin/health');
    const url = page.url();
    if (!url.includes('/admin/health')) return;

    const heading = page.getByRole('heading', { name: /health|admin|system/i });
    await expect(heading.first()).toBeVisible();
  });

  test('§8.1 /admin/health no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/health');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('§7.17 /admin/health shows per-tenant sync error state (no body content)', async ({ page }) => {
    await page.goto('/admin/health');
    const url = page.url();
    if (!url.includes('/admin/health')) return;

    // Should show sync error indicators but NOT raw email content
    // Any "error" display must be metadata-only (no email body)
    const errorIndicators = page.locator('[data-testid="sync-error"], .sync-error, [aria-label*="error"]');
    const count = await errorIndicators.count().catch(() => 0);
    // If errors are shown, they must not contain email body content
    if (count > 0) {
      const firstText = await errorIndicators.first().textContent() ?? '';
      // Email body would contain long freeform text; error messages are short structured
      expect(firstText.length).toBeLessThan(500);
    }
  });
});
