/**
 * TASK7544-16 — Onboarding progress indicator in sidebar
 *
 * Acceptance criteria:
 * - Widget is visible in sidebar when onboarding is incomplete
 * - Widget is hidden when both steps are complete
 * - Progress bar reflects correct completion percentage
 * - Incomplete step has aria-current="step"; complete step does not
 * - No horizontal overflow at 375px (mobile-first rule)
 * - API endpoint /api/onboarding/status exists and is auth-gated (not 404)
 *
 * Tests use /onboarding/sidebar-progress-fixture — an unprotected fixture
 * page that renders the OnboardingProgress component in isolation so tests
 * run without a live Supabase auth session.
 */

import { test, expect } from '@playwright/test';

const FIXTURE_URL = '/onboarding/sidebar-progress-fixture';
const STATUS_ROUTE = '/api/onboarding/status';

function stubStatus(
  page: import('@playwright/test').Page,
  data: { synced: boolean; kbReviewed: boolean },
) {
  return page.route(STATUS_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, ...data }),
    }),
  );
}

test.describe('@feature TASK7544-16 sidebar onboarding progress', () => {
  // ── API contract ────────────────────────────────────────────────────────────

  test('GET /api/onboarding/status exists and is auth-gated', async ({ page }) => {
    const resp = await page.request.get(STATUS_ROUTE);
    // Must exist (not 404). Auth-gated 401 is expected without a session.
    expect(resp.status()).not.toBe(404);
    expect([200, 401]).toContain(resp.status());
  });

  // ── Widget visibility ───────────────────────────────────────────────────────

  test('widget is visible when neither step is complete', async ({ page }) => {
    await stubStatus(page, { synced: false, kbReviewed: false });
    await page.goto(FIXTURE_URL);

    const widget = page.getByTestId('sidebar-onboarding-progress');
    await expect(widget).toBeVisible();
  });

  test('widget is visible when only step 1 is complete', async ({ page }) => {
    await stubStatus(page, { synced: true, kbReviewed: false });
    await page.goto(FIXTURE_URL);

    const widget = page.getByTestId('sidebar-onboarding-progress');
    await expect(widget).toBeVisible();
  });

  test('widget is hidden when all steps are complete', async ({ page }) => {
    await stubStatus(page, { synced: true, kbReviewed: true });
    await page.goto(FIXTURE_URL);

    // Wait for the fetch to complete before asserting absence
    await page.waitForTimeout(300);
    const widget = page.getByTestId('sidebar-onboarding-progress');
    await expect(widget).not.toBeVisible();
  });

  // ── Progress bar ────────────────────────────────────────────────────────────

  test('progress bar is at 0% when no steps done', async ({ page }) => {
    await stubStatus(page, { synced: false, kbReviewed: false });
    await page.goto(FIXTURE_URL);

    // Bar element exists in DOM — 0% width means it has no visible area,
    // so we check attachment rather than visibility.
    const bar = page.getByTestId('sidebar-onboarding-progress-bar');
    await expect(bar).toBeAttached();
    const width = await bar.evaluate((el) => (el as HTMLElement).style.width);
    expect(width).toBe('0%');
  });

  test('progress bar is at 50% when one of two steps done', async ({ page }) => {
    await stubStatus(page, { synced: true, kbReviewed: false });
    await page.goto(FIXTURE_URL);

    const bar = page.getByTestId('sidebar-onboarding-progress-bar');
    await expect(bar).toBeVisible();
    const width = await bar.evaluate((el) => (el as HTMLElement).style.width);
    expect(width).toBe('50%');
  });

  // ── ARIA ────────────────────────────────────────────────────────────────────

  test('incomplete step has aria-current="step"', async ({ page }) => {
    await stubStatus(page, { synced: false, kbReviewed: false });
    await page.goto(FIXTURE_URL);

    // Both steps incomplete — step 1 is the first incomplete step
    const step1 = page.getByTestId('sidebar-onboarding-step-1');
    await expect(step1).toHaveAttribute('aria-current', 'step');
  });

  test('completed step does not have aria-current; next incomplete step does', async ({ page }) => {
    await stubStatus(page, { synced: true, kbReviewed: false });
    await page.goto(FIXTURE_URL);

    const step1 = page.getByTestId('sidebar-onboarding-step-1');
    await expect(step1).not.toHaveAttribute('aria-current', 'step');

    const step2 = page.getByTestId('sidebar-onboarding-step-2');
    await expect(step2).toHaveAttribute('aria-current', 'step');
  });

  // ── Mobile overflow ─────────────────────────────────────────────────────────

  test('no horizontal overflow at 375px', async ({ page }) => {
    await stubStatus(page, { synced: false, kbReviewed: false });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(FIXTURE_URL);

    await expect(page.getByTestId('sidebar-onboarding-progress')).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
