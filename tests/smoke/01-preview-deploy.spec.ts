import { test, expect } from '@playwright/test';

/**
 * Preview-deploy smoke suite (@smoke preview-deploy)
 *
 * Runs against PLAYWRIGHT_BASE_URL (defaults to localhost:3001).
 * Designed to gate Vercel preview deploys: validates every route
 * returns a healthy response and protected routes redirect
 * unauthenticated visitors to /connect.
 *
 * AINBOX-33 §Test-Layer-A
 */

test.describe('@smoke preview-deploy', () => {
  // ── Landing ─────────────────────────────────────────────────────────────

  test('landing page has Ainbox title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Ainbox/i);
  });

  // ── Public marketing + legal — must not 500 ──────────────────────────────
  // Separate tests (not one loop body) to avoid "Navigation interrupted by
  // another navigation" when navigations overlap inside a single test.

  for (const path of ['/pricing', '/security', '/legal/privacy', '/legal/terms']) {
    test(`public page ok: ${path}`, async ({ page }) => {
      const resp = await page.goto(path, { waitUntil: 'load' });
      expect(resp?.status()).toBeLessThan(500);
    });
  }

  // ── Auth-entry + onboarding — public, must not 500 ───────────────────────

  for (const path of [
    '/connect',
    '/connect/google',
    '/connect/microsoft',
    '/onboarding/sync',
    '/onboarding/kb-review',
  ]) {
    test(`auth-entry page ok: ${path}`, async ({ page }) => {
      const resp = await page.goto(path, { waitUntil: 'load' });
      expect(resp?.status()).toBeLessThan(500);
    });
  }

  // ── Protected app pages — unauthenticated visitor must land on /connect ──
  // The middleware (src/middleware.ts) issues a 302 → /connect?next=<path>.
  // Playwright follows the redirect automatically; we assert the final URL.

  for (const path of [
    '/inbox',
    '/drafts',
    '/knowledge',
    '/automation',
    '/audit',
    '/settings',
    '/settings/account',
    '/settings/providers',
  ]) {
    test(`protected route redirects to /connect: ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'load' });
      expect(page.url()).toContain('/connect');
    });
  }
});
