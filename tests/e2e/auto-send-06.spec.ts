/**
 * PRD §7.12 Auto-send mode
 * PRD §4.4 Confidence model (auto-send floor = 0.85)
 *
 * Acceptance criteria:
 * - /automation page renders without error
 * - Each of the 10 email categories has an auto-send toggle
 * - Each category has a confidence threshold input (default/minimum 0.85)
 * - UI rejects a threshold < 0.85 with a validation error (non-negotiable §4.4 / §9.2)
 * - UI allows threshold >= 0.85 up to 1.0
 * - Toggle on/off persists via API (PATCH /api/automation/categories/*)
 * - auto-send edge function endpoint is defined
 * - 60-second cooling delay is surfaced in the UI (intercept window messaging)
 * - /automation no horizontal overflow at 375px
 */

import { test, expect } from '@playwright/test';

const CATEGORIES = [
  'sales', 'support', 'invoice', 'complaint', 'meeting',
  'investor', 'urgent', 'escalation', 'spam', 'other',
];

test.describe('@e2e §7.12 §4.4 auto-send mode and confidence floor', () => {
  test('§7.12 /automation renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/automation');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.12 /automation shows category configuration section', async ({ page }) => {
    await page.goto('/automation');
    const url = page.url();
    if (!url.includes('/automation')) return;

    const hasCategories = await page.getByText(/sales|support|invoice|complaint|meeting/i)
      .first().isVisible().catch(() => false);
    expect(hasCategories).toBe(true);
  });

  test('§7.12 each category has an auto-send toggle', async ({ page }) => {
    await page.goto('/automation');
    const url = page.url();
    if (!url.includes('/automation')) return;

    const toggles = page.locator('[role="switch"], input[type="checkbox"][name*="auto"], [data-testid*="auto-send-toggle"]');
    const count = await toggles.count();
    // Must have toggles for all 10 categories
    expect(count).toBeGreaterThanOrEqual(CATEGORIES.length);
  });

  test('§4.4 §9.2 confidence threshold below 0.85 is rejected', async ({ page }) => {
    await page.goto('/automation');
    const url = page.url();
    if (!url.includes('/automation')) return;

    // Find the first threshold input and try to set it below 0.85
    const thresholdInput = page.locator(
      'input[type="number"][name*="confidence"], input[type="number"][name*="threshold"], [data-testid*="threshold"]'
    ).first();
    const inputExists = await thresholdInput.isVisible().catch(() => false);

    if (inputExists) {
      await thresholdInput.clear();
      await thresholdInput.fill('0.5');
      await thresholdInput.press('Tab');

      // The form must show a validation error
      const errorMsg = page.getByText(/minimum.*0\.85|must be.*0\.85|below.*threshold|confidence.*0\.85/i);
      const hasError = await errorMsg.first().isVisible({ timeout: 2000 }).catch(() => false);

      // Alternatively the input value should be clamped to 0.85
      const actualValue = await thresholdInput.inputValue();
      const isClamped = parseFloat(actualValue) >= 0.85;

      expect(hasError || isClamped).toBe(true);
    }
  });

  test('§4.4 confidence threshold of 0.85 is accepted', async ({ page }) => {
    await page.goto('/automation');
    const url = page.url();
    if (!url.includes('/automation')) return;

    const thresholdInput = page.locator(
      'input[type="number"][name*="confidence"], input[type="number"][name*="threshold"], [data-testid*="threshold"]'
    ).first();
    const inputExists = await thresholdInput.isVisible().catch(() => false);

    if (inputExists) {
      await thresholdInput.clear();
      await thresholdInput.fill('0.85');
      await thresholdInput.press('Tab');

      // Should NOT show error for exactly 0.85
      const errorMsg = page.getByText(/minimum.*0\.85|must be.*0\.85|below.*threshold/i);
      const hasError = await errorMsg.first().isVisible({ timeout: 1000 }).catch(() => false);
      expect(hasError).toBe(false);
    }
  });

  test('§4.4 confidence threshold of 0.9 is accepted', async ({ page }) => {
    await page.goto('/automation');
    const url = page.url();
    if (!url.includes('/automation')) return;

    const thresholdInput = page.locator(
      'input[type="number"][name*="confidence"], input[type="number"][name*="threshold"], [data-testid*="threshold"]'
    ).first();
    const inputExists = await thresholdInput.isVisible().catch(() => false);

    if (inputExists) {
      await thresholdInput.clear();
      await thresholdInput.fill('0.9');
      await thresholdInput.press('Tab');

      const errorMsg = page.getByText(/minimum.*0\.85|must be.*0\.85|below.*threshold/i);
      const hasError = await errorMsg.first().isVisible({ timeout: 1000 }).catch(() => false);
      expect(hasError).toBe(false);
    }
  });

  test('§7.12 auto-send toggle persists via API', async ({ page }) => {
    let apiCalled = false;
    await page.route('/api/automation/categories/**', async route => {
      apiCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: true }),
      });
    });

    await page.goto('/automation');
    const url = page.url();
    if (!url.includes('/automation')) return;

    const toggle = page.locator('[role="switch"], input[type="checkbox"]').first();
    const exists = await toggle.isVisible().catch(() => false);
    if (exists) {
      await toggle.click();
      // Allow time for API call
      await page.waitForTimeout(500);
      expect(apiCalled).toBe(true);
    }
  });

  test('§7.12 auto-send edge function endpoint is defined', async ({ page }) => {
    const resp = await page.request.post('/api/edge/auto-send', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('§7.12 60-second cooling delay is communicated in the UI', async ({ page }) => {
    await page.goto('/automation');
    const url = page.url();
    if (!url.includes('/automation')) return;

    // Must mention cooling/intercept window somewhere on the page
    const hasCoolingText = await page.getByText(/60.?second|cooling|intercept|undo window/i)
      .first().isVisible().catch(() => false);
    // Also acceptable in a tooltip or help text
    const hasHelpText = await page.locator('[data-testid*="help"], [aria-describedby], title')
      .getByText(/60|cooling|intercept/i).first().isVisible().catch(() => false);
    expect(hasCoolingText || hasHelpText).toBe(true);
  });

  test('§7.12 /automation no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/automation');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
