/**
 * TASK7544-19 — /connect rebranded as the signup landing (Rawgle visual pattern)
 *
 * The /connect page is now a split-panel signup landing:
 *  - Left panel: brand/hero with value proposition (visible sm+)
 *  - Right panel: auth card with provider buttons
 *  - Mobile (375px): single column, left panel hidden, wordmark shown above card
 *
 * Acceptance criteria:
 * - Page loads without 5xx
 * - h2 "Connect your inbox" is visible (satisfies the existing /connect/i heading contract)
 * - Google and Microsoft provider buttons are present and labelled correctly
 * - Left-panel brand content visible at desktop width
 * - Left panel hidden at 375px (mobile-first requirement)
 * - Trust-signal copy ("14-day free trial") is present
 * - Footer legal links (Privacy, Terms, Security) are present
 * - Page title (wordmark) links back to /
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const CONNECT_PAGE = path.join(
  __dirname,
  '../../src/app/connect/page.tsx',
);

function readSource(): string {
  return fs.readFileSync(CONNECT_PAGE, 'utf-8');
}

test.describe('@feature TASK7544-19 /connect signup landing (Rawgle visual pattern)', () => {
  // ── Static source checks ────────────────────────────────────────────────

  test('split-panel root: flex row layout applied at sm breakpoint', () => {
    const src = readSource();
    expect(src).toContain('sm:flex-row');
  });

  test('left panel is hidden on mobile via hidden sm:flex', () => {
    const src = readSource();
    expect(src).toContain('hidden sm:flex');
  });

  test('left panel background is dark (slate-900)', () => {
    const src = readSource();
    expect(src).toContain('bg-slate-900');
  });

  test('h2 reads "Connect your inbox"', () => {
    const src = readSource();
    expect(src).toContain('Connect your inbox');
  });

  test('Google button is present with correct aria-label', () => {
    const src = readSource();
    expect(src).toContain('aria-label="Continue with Google"');
  });

  test('Microsoft button is present with correct aria-label', () => {
    const src = readSource();
    expect(src).toContain('aria-label="Continue with Microsoft"');
  });

  test('trust-signal copy is present', () => {
    const src = readSource();
    expect(src).toContain('14-day free trial');
  });

  test('footer links: Privacy, Terms, Security', () => {
    const src = readSource();
    expect(src).toContain('/legal/privacy');
    expect(src).toContain('/legal/terms');
    expect(src).toContain('/security');
  });

  test('mobile wordmark links back to /', () => {
    const src = readSource();
    // Link to / inside the mobile-only wordmark div
    expect(src).toMatch(/sm:hidden[\s\S]{0,300}href="\/"/);
  });

  test('hard navigation preserved: window.location.href used for provider routes', () => {
    const src = readSource();
    expect(src).toContain('window.location.href');
    expect(src).toContain("go('/connect/google')");
    expect(src).toContain("go('/connect/microsoft')");
  });

  // ── Runtime checks (iphone-15 project) ─────────────────────────────────

  test('§7.1 page loads and heading is visible', async ({ page }) => {
    const resp = await page.goto('/connect');
    expect(resp?.status()).toBeLessThan(500);
    // The h2 satisfies the /connect/i heading contract expected by auth-google.spec.ts
    await expect(page.getByRole('heading', { name: /connect/i })).toBeVisible();
  });

  test('§7.1 Google and Microsoft buttons are rendered', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /microsoft/i })).toBeVisible();
  });

  test('§7.1 Google button navigates to /connect/google', async ({ page }) => {
    // Intercept the navigation so the test stays hermetic
    let navigated = false;
    await page.route('**/connect/google', (route) => {
      navigated = true;
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' });
    });

    await page.goto('/connect');
    await page.getByRole('button', { name: /google/i }).click();
    await page.waitForURL(/\/connect\/google/, { timeout: 5000 });
    expect(navigated || page.url().includes('/connect/google')).toBe(true);
  });

  test('§7.1 Microsoft button navigates to /connect/microsoft', async ({ page }) => {
    let navigated = false;
    await page.route('**/connect/microsoft', (route) => {
      navigated = true;
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' });
    });

    await page.goto('/connect');
    await page.getByRole('button', { name: /microsoft/i }).click();
    await page.waitForURL(/\/connect\/microsoft/, { timeout: 5000 });
    expect(navigated || page.url().includes('/connect/microsoft')).toBe(true);
  });

  test('trust signal "14-day free trial" is visible on page', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText(/14-day free trial/i)).toBeVisible();
  });

  test('mobile: no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/connect');
    const body = page.locator('body');
    const bodyWidth = await body.evaluate((el) => el.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
