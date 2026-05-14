/**
 * TASKRESPONSE-53 — Onboarding L1: numbered stepper + 'Step N of M' header
 *
 * Acceptance criteria:
 * - /onboarding/sync shows "Step 1 of 2" and step-1 pill is active
 * - /onboarding/kb-review shows "Step 2 of 2" and step-2 pill is active, step-1 is done
 * - No horizontal overflow at 375px (mobile-first rule)
 */

import { test, expect } from '@playwright/test';

test.describe('@feature TASKRESPONSE-53 onboarding stepper', () => {
  test('sync page shows Step 1 of 2 with step-1 active', async ({ page }) => {
    // Intercept the sync API calls so the page doesn't hang
    await page.route('/api/sync/*', (route) => route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }));
    await page.route('/api/sync/status', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ counts: { synced: 0, classified: 0, drafts: 0, kb: 0 } }) }),
    );

    await page.goto('/onboarding/sync');

    const stepper = page.getByTestId('onboarding-stepper');
    await expect(stepper).toBeVisible();

    // "Step N of M" label
    const label = page.getByTestId('onboarding-step-label');
    await expect(label).toHaveText('Step 1 of 2');

    // Step 1 pill exists and is marked current
    const step1 = page.getByTestId('onboarding-step-1');
    await expect(step1).toBeVisible();
    await expect(step1).toHaveAttribute('aria-current', 'step');

    // Step 2 exists but is NOT marked current
    const step2 = page.getByTestId('onboarding-step-2');
    await expect(step2).toBeVisible();
    await expect(step2).not.toHaveAttribute('aria-current', 'step');
  });

  test('kb-review page shows Step 2 of 2 with step-2 active', async ({ page }) => {
    // Intercept the KB API calls
    await page.route('/api/kb/items', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, items: [], grouped: {} }) }),
    );

    await page.goto('/onboarding/kb-review');

    const stepper = page.getByTestId('onboarding-stepper');
    await expect(stepper).toBeVisible();

    // "Step N of M" label
    const label = page.getByTestId('onboarding-step-label');
    await expect(label).toHaveText('Step 2 of 2');

    // Step 2 pill is active
    const step2 = page.getByTestId('onboarding-step-2');
    await expect(step2).toBeVisible();
    await expect(step2).toHaveAttribute('aria-current', 'step');

    // Step 1 is completed (done), not current
    const step1 = page.getByTestId('onboarding-step-1');
    await expect(step1).toBeVisible();
    await expect(step1).not.toHaveAttribute('aria-current', 'step');
  });

  test('no horizontal overflow at 375px on sync page', async ({ page }) => {
    await page.route('/api/sync/*', (route) => route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }));
    await page.route('/api/sync/status', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ counts: { synced: 0, classified: 0, drafts: 0, kb: 0 } }) }),
    );

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/onboarding/sync');

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('no horizontal overflow at 375px on kb-review page', async ({ page }) => {
    await page.route('/api/kb/items', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, items: [], grouped: {} }) }),
    );

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/onboarding/kb-review');

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
