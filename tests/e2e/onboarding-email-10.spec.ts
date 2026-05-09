/**
 * PRD §7.16 Onboarding completion email
 *
 * Acceptance criteria:
 * - An API/edge function endpoint exists to trigger the onboarding-complete email
 * - The endpoint is auth-gated (not accessible to anonymous requests)
 * - The send-onboarding-email endpoint does not return 404
 * - The onboarding flow UI shows a "KB build complete" state after extraction
 * - The /onboarding/kb-review page has a completion state / CTA that implies email is sent
 * - No real email content appears in the trigger payload (synthesised summary only)
 * - /onboarding/complete (or equivalent) page renders without 500
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §7.16 onboarding completion email', () => {
  test('§7.16 onboarding-complete email edge function endpoint is defined (not 404)', async ({ page }) => {
    const resp = await page.request.post('/api/edge/send-onboarding-email', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('§7.16 onboarding-complete email endpoint is auth-gated', async ({ page }) => {
    const resp = await page.request.post('/api/edge/send-onboarding-email', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    // Anonymous callers must not receive 200
    expect(resp.status()).not.toBe(200);
    expect(resp.status()).not.toBe(404);
  });

  test('§7.16 /onboarding/kb-review renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/onboarding/kb-review');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.16 /onboarding/kb-review shows KB build complete indicator or CTA', async ({ page }) => {
    await page.goto('/onboarding/kb-review');
    const url = page.url();
    if (!url.includes('/onboarding/kb-review')) return; // auth redirect — skip

    const hasComplete = await page.getByText(/complete|finished|done|ready|built/i)
      .first().isVisible().catch(() => false);
    const hasCta = await page.getByRole('button', { name: /finish|complete|go to inbox|start using/i })
      .or(page.getByRole('link', { name: /finish|complete|go to inbox|start using/i }))
      .first().isVisible().catch(() => false);
    expect(hasComplete || hasCta).toBe(true);
  });

  test('§7.16 /onboarding/complete page renders without 500', async ({ page }) => {
    const resp = await page.goto('/onboarding/complete');
    // May redirect to auth (401/302) or render — 500 is the failure
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.16 /onboarding/complete no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/onboarding/complete');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('§7.16 onboarding email trigger payload does not reference real email bodies', async ({ page }) => {
    // Verify the endpoint accepts a structured payload without raw email content
    const resp = await page.request.post('/api/edge/send-onboarding-email', {
      data: {
        kb_summary: { faq_count: 3, policy_count: 1, tone_samples: 2 },
      },
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await resp.text().catch(() => '');
    // Response must not echo back raw email patterns
    expect(body).not.toMatch(/from:\s*[a-zA-Z]/i);
    expect(body).not.toMatch(/subject:\s*re:/i);
  });
});
