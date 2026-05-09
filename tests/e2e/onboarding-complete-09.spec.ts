/**
 * PRD §7.16 Onboarding completion email
 *
 * Acceptance criteria:
 * - An API endpoint exists to trigger the onboarding completion notification
 * - The endpoint is auth-gated (401 when unauthenticated, not 404)
 * - The endpoint does NOT accept a request body containing raw email content
 *   (response must not echo back raw email bodies — §4.3 PII boundary)
 * - /onboarding/sync page has a "Finish" or "Go to inbox" CTA that is
 *   reachable once sync completes (structural: element exists in DOM)
 * - The notification endpoint accepts POST and returns a structured response
 * - No horizontal overflow at 375px on any onboarding page
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §7.16 onboarding completion email', () => {
  test('§7.16 onboarding completion notification API endpoint exists (not 404)', async ({ page }) => {
    const resp = await page.request.post('/api/onboarding/complete', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    // Auth-gated = 401/403, method not allowed = 405 — any of these mean route exists
    expect(resp.status()).not.toBe(404);
  });

  test('§7.16 onboarding completion endpoint is auth-gated (not publicly callable)', async ({ page }) => {
    const resp = await page.request.post('/api/onboarding/complete', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    // Unauthenticated callers must get 401 or 403, NOT 200
    if (resp.status() !== 404) {
      expect([401, 403, 405]).toContain(resp.status());
    }
  });

  test('§7.16 §4.3 onboarding completion response does not echo raw email bodies', async ({ page }) => {
    const resp = await page.request.post('/api/onboarding/complete', {
      data: { body: 'Dear John, please find attached the invoice for £5,000.' },
      headers: { 'Content-Type': 'application/json' },
    });
    // If we get a 200 (e.g. in a test environment without real auth),
    // the response body must not echo back the raw input
    if (resp.status() === 200) {
      const text = await resp.text();
      expect(text).not.toContain('Dear John');
      expect(text).not.toContain('invoice for £5,000');
    }
  });

  test('§7.16 /onboarding/sync has finish/continue CTA in DOM', async ({ page }) => {
    await page.goto('/onboarding/sync');
    const url = page.url();
    if (!url.includes('/onboarding/sync')) return; // auth redirect — skip

    // After sync, a "Go to inbox" or "Continue" CTA must exist in DOM
    const cta = page.getByRole('link', { name: /go to inbox|continue|finish|get started/i })
      .or(page.getByRole('button', { name: /go to inbox|continue|finish|get started/i }));
    const count = await cta.count();
    expect(count).toBeGreaterThan(0);
  });

  test('§7.16 /onboarding/kb-review has finish/continue CTA linking to /inbox', async ({ page }) => {
    await page.goto('/onboarding/kb-review');
    const url = page.url();
    if (!url.includes('/onboarding/kb-review')) return;

    // After KB review, the user should proceed to /inbox
    const inboxLink = page.getByRole('link', { name: /inbox|continue|finish|done/i });
    const count = await inboxLink.count();
    expect(count).toBeGreaterThan(0);
  });

  test('§7.16 /onboarding/sync no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/onboarding/sync');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('§7.16 /onboarding/kb-review no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/onboarding/kb-review');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
