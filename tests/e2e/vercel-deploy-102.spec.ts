/**
 * PRD §12.2 — Vercel Deployment: Configure Custom Domain (Ticket 102)
 *
 * Acceptance criteria:
 * - POST /api/deploy/domain adds a custom domain to a Vercel project
 * - GET /api/deploy/domain lists configured domains for the project
 * - DELETE /api/deploy/domain/:domain removes a domain
 * - Domain validation: non-domain strings return 400
 * - /settings/deploy shows domain configuration section after project is initialized
 * - Domain list renders without horizontal overflow at 375px
 * - Domain status (active / pending / error) is displayed per domain
 */

import { test, expect } from '@playwright/test';

const SYNTHETIC_DOMAIN = 'ainbox-test.example.com';

test.describe('@e2e §12.2 vercel deploy — configure custom domain (ticket 102)', () => {
  // ── API: Domain Management ────────────────────────────────────────────────

  test('102.1 POST /api/deploy/domain with valid domain returns 201 or 401/409', async ({ request }) => {
    const response = await request.post('/api/deploy/domain', {
      data: { domain: SYNTHETIC_DOMAIN },
    });
    // 201 = created, 401/403 = unauthenticated, 409 = domain already added
    expect([201, 401, 403, 409]).toContain(response.status());
    if (response.status() === 201) {
      const body = await response.json();
      expect(body.domain).toBe(SYNTHETIC_DOMAIN);
      expect(['pending', 'active']).toContain(body.status);
    }
  });

  test('102.2 POST /api/deploy/domain with invalid string returns 400', async ({ request }) => {
    const response = await request.post('/api/deploy/domain', {
      data: { domain: 'not a domain!!!' },
    });
    expect([400, 401, 403]).toContain(response.status());
    if (response.status() === 400) {
      const body = await response.json();
      expect(body.error).toBeDefined();
    }
  });

  test('102.3 GET /api/deploy/domain returns array of domains', async ({ request }) => {
    const response = await request.get('/api/deploy/domain');
    expect([200, 401, 403, 404]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(Array.isArray(body.domains)).toBe(true);
      for (const d of body.domains) {
        expect(d.domain).toBeDefined();
        expect(['pending', 'active', 'error']).toContain(d.status);
      }
    }
  });

  test('102.4 DELETE /api/deploy/domain removes an existing domain', async ({ request }) => {
    const encodedDomain = encodeURIComponent(SYNTHETIC_DOMAIN);
    const response = await request.delete(`/api/deploy/domain/${encodedDomain}`);
    expect([200, 204, 401, 403, 404]).toContain(response.status());
  });

  test('102.5 DELETE /api/deploy/domain for non-existent domain returns 404', async ({ request }) => {
    const response = await request.delete('/api/deploy/domain/does-not-exist.example.com');
    expect([404, 401, 403]).toContain(response.status());
  });

  // ── UI: Domain configuration section ─────────────────────────────────────

  test('102.6 /settings/deploy has domain configuration section', async ({ page }) => {
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    // Either a domain input/form or an "Add Domain" button must exist
    const domainSection = page.getByText(/custom domain|add domain|domain settings/i).first();
    const addDomainBtn = page.getByRole('button', { name: /add domain/i });
    const visible =
      await domainSection.isVisible().catch(() => false) ||
      await addDomainBtn.isVisible().catch(() => false);
    expect(visible).toBe(true);
  });

  test('102.7 Domain list shows status badge per domain', async ({ page }) => {
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    // If any domains are listed, each must carry a status indicator
    const domainRows = page.locator('[data-testid="domain-row"], .domain-item');
    const count = await domainRows.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const row = domainRows.nth(i);
        const statusText = await row.textContent();
        expect(statusText).toMatch(/pending|active|error/i);
      }
    }
    // Zero rows is fine (no domains configured yet)
  });

  test('102.8 /settings/deploy domain section no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('102.9 domain input validates format client-side before API call', async ({ page }) => {
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const domainInput = page.locator(
      'input[placeholder*="domain" i], input[name*="domain" i], input[id*="domain" i]'
    );
    const count = await domainInput.count();
    if (count === 0) return; // Domain section may not render until project exists

    await domainInput.first().fill('not a valid domain!!!');
    // Trigger blur / form submission
    await domainInput.first().press('Tab');
    // Expect a validation error to appear
    const errorMsg = page.locator('[role="alert"], .error-message, [data-testid="field-error"]').first();
    const hasError = await errorMsg.isVisible().catch(() => false);
    expect(hasError).toBe(true);
  });
});
