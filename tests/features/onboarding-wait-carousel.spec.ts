/**
 * TASK7544-23 — /onboarding/wait: rotating carousel waiting screen
 *
 * Acceptance criteria:
 * - /onboarding/wait renders the carousel with slides
 * - OnboardingStepper shows "Step 1 of 2" with step-1 active
 * - Progress bar is visible
 * - Prev/Next buttons navigate between slides
 * - Dot indicators reflect the active slide
 * - No horizontal overflow at 375px (mobile-first rule)
 * - /onboarding/sync redirects to /onboarding/wait
 */

import { test, expect } from '@playwright/test';

function stubSyncAPIs(page: Parameters<Parameters<typeof test>[1]>[0]) {
  return Promise.all([
    page.route('/api/sync/gmail', (r) =>
      r.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }),
    ),
    page.route('/api/sync/outlook', (r) =>
      r.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }),
    ),
    page.route('/api/sync/status', (r) =>
      r.fulfill({
        status: 200,
        body: JSON.stringify({
          counts: { synced: 0, classified: 0, drafts: 0, kb: 0 },
        }),
      }),
    ),
  ]);
}

test.describe('@feature TASK7544-23 onboarding wait carousel', () => {
  test('renders the carousel card', async ({ page }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/wait');

    await expect(page.getByTestId('wait-carousel')).toBeVisible();
  });

  test('shows onboarding stepper at Step 1 of 2', async ({ page }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/wait');

    await expect(page.getByTestId('onboarding-stepper')).toBeVisible();
    await expect(page.getByTestId('onboarding-step-label')).toHaveText(
      'Step 1 of 2',
    );
    await expect(page.getByTestId('onboarding-step-1')).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(page.getByTestId('onboarding-step-2')).not.toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  test('progress bar is visible', async ({ page }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/wait');

    await expect(page.getByTestId('wait-progress-bar')).toBeVisible();
    // Fill starts at 0 width (not yet synced) — check it exists in the DOM
    await expect(page.getByTestId('wait-progress-fill')).toBeAttached();
  });

  test('first slide headline is visible on load', async ({ page }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/wait');

    await expect(page.getByTestId('wait-slide-headline')).toBeVisible();
  });

  test('Next button advances to second slide', async ({ page }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/wait');

    const headline1 = await page
      .getByTestId('wait-slide-headline')
      .textContent();

    await page.getByTestId('wait-next').click();

    const headline2 = await page
      .getByTestId('wait-slide-headline')
      .textContent();

    expect(headline2).not.toBe(headline1);
  });

  test('Prev button wraps around to last slide from first', async ({ page }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/wait');

    const headline1 = await page
      .getByTestId('wait-slide-headline')
      .textContent();

    await page.getByTestId('wait-prev').click();

    const headlineLast = await page
      .getByTestId('wait-slide-headline')
      .textContent();

    expect(headlineLast).not.toBe(headline1);
  });

  test('dot indicators are present and first dot is active', async ({
    page,
  }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/wait');

    const dots = page.getByTestId('wait-dots');
    await expect(dots).toBeVisible();

    // First dot should be selected
    const dot0 = page.getByTestId('wait-dot-0');
    await expect(dot0).toHaveAttribute('aria-selected', 'true');

    // Second dot is not selected
    const dot1 = page.getByTestId('wait-dot-1');
    await expect(dot1).toHaveAttribute('aria-selected', 'false');
  });

  test('clicking a dot navigates to that slide', async ({ page }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/wait');

    const headline1 = await page
      .getByTestId('wait-slide-headline')
      .textContent();

    await page.getByTestId('wait-dot-2').click();

    const headline3 = await page
      .getByTestId('wait-slide-headline')
      .textContent();

    expect(headline3).not.toBe(headline1);

    // dot-2 is now active, dot-0 is not
    await expect(page.getByTestId('wait-dot-2')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('wait-dot-0')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('syncing button is shown while sync is in progress', async ({
    page,
  }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/wait');

    await expect(page.getByTestId('wait-syncing-button')).toBeVisible();
    await expect(page.getByTestId('wait-syncing-button')).toBeDisabled();
  });

  test('no horizontal overflow at 375px', async ({ page }) => {
    await stubSyncAPIs(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/onboarding/wait');

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });

  test('/onboarding/sync redirects to /onboarding/wait', async ({ page }) => {
    await stubSyncAPIs(page);
    await page.goto('/onboarding/sync');

    await expect(page).toHaveURL(/\/onboarding\/wait/);
    // The carousel should be visible after the redirect
    await expect(page.getByTestId('wait-carousel')).toBeVisible();
  });
});
