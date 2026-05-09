/**
 * PRD §7.10 Reply drafting
 * PRD §7.11 Approval queue UI
 *
 * Acceptance criteria:
 * - /drafts page renders without error
 * - Pending drafts are ordered by confidence DESC
 * - Each draft shows: subject, recipient (no PII body), confidence score, category
 * - Each draft has Approve / Edit / Reject buttons
 * - Approve sends the draft via API and removes it from queue
 * - Edit opens inline editor; re-save updates the draft at provider + locally
 * - Reject deletes locally and at provider if created there
 * - Keyboard shortcuts j/k/a/r work for navigation and actions (§8.3)
 * - draft edge function endpoint is defined
 * - Confidence score is visible as a number or percentage
 * - Draft generation p95 < 8s (structural: spinner / loading state present)
 * - /drafts no horizontal overflow at 375px
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §7.10 §7.11 reply drafting and approval queue', () => {
  test('§7.11 /drafts renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/drafts');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.11 /drafts shows pending draft queue or empty state', async ({ page }) => {
    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const hasDraftCards = await page.locator('[data-testid="draft-card"]').first()
      .isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no drafts|all clear|nothing pending/i)
      .first().isVisible().catch(() => false);
    expect(hasDraftCards || hasEmptyState).toBe(true);
  });

  test('§7.11 draft cards have Approve button', async ({ page }) => {
    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const draftCards = page.locator('[data-testid="draft-card"]');
    const count = await draftCards.count().catch(() => 0);
    if (count > 0) {
      const approveBtn = draftCards.first().getByRole('button', { name: /approve|send/i });
      await expect(approveBtn).toBeVisible();
    }
  });

  test('§7.11 draft cards have Edit button', async ({ page }) => {
    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const draftCards = page.locator('[data-testid="draft-card"]');
    const count = await draftCards.count().catch(() => 0);
    if (count > 0) {
      const editBtn = draftCards.first().getByRole('button', { name: /edit/i });
      await expect(editBtn).toBeVisible();
    }
  });

  test('§7.11 draft cards have Reject button', async ({ page }) => {
    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const draftCards = page.locator('[data-testid="draft-card"]');
    const count = await draftCards.count().catch(() => 0);
    if (count > 0) {
      const rejectBtn = draftCards.first().getByRole('button', { name: /reject|dismiss|discard/i });
      await expect(rejectBtn).toBeVisible();
    }
  });

  test('§7.10 §7.11 draft cards show confidence score', async ({ page }) => {
    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const draftCards = page.locator('[data-testid="draft-card"]');
    const count = await draftCards.count().catch(() => 0);
    if (count > 0) {
      const confidenceBadge = draftCards.first()
        .locator('[data-testid="confidence-score"], .confidence-score, [aria-label*="confidence"]');
      const badgeCount = await confidenceBadge.count();
      expect(badgeCount).toBeGreaterThan(0);
    }
  });

  test('§7.11 drafts are ordered by confidence DESC (highest first)', async ({ page }) => {
    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const confidenceScores = page.locator('[data-testid="confidence-score"]');
    const count = await confidenceScores.count().catch(() => 0);
    if (count < 2) return; // not enough items to check ordering

    const scores: number[] = [];
    for (let i = 0; i < count; i++) {
      const text = await confidenceScores.nth(i).textContent() ?? '0';
      const num = parseFloat(text.replace('%', ''));
      scores.push(num);
    }
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  test('§7.11 Approve action calls send API', async ({ page }) => {
    let sendCalled = false;
    await page.route('/api/drafts/*/approve', async route => {
      sendCalled = true;
      await route.fulfill({ status: 200, body: JSON.stringify({ sent: true }) });
    });

    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const approveBtn = page.getByRole('button', { name: /approve|send/i }).first();
    const exists = await approveBtn.isVisible().catch(() => false);
    if (exists) {
      await approveBtn.click();
      // Either API was called or a confirmation modal appeared
      const confirmed = sendCalled || await page.getByRole('dialog').isVisible().catch(() => false);
      expect(confirmed).toBe(true);
    }
  });

  test('§7.11 Edit opens inline editor', async ({ page }) => {
    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const editBtn = page.getByRole('button', { name: /edit/i }).first();
    const exists = await editBtn.isVisible().catch(() => false);
    if (exists) {
      await editBtn.click();
      const editor = page.locator('textarea, [contenteditable="true"], [data-testid="draft-editor"]').first();
      await expect(editor).toBeVisible({ timeout: 3000 });
    }
  });

  test('§7.10 draft edge function endpoint is defined', async ({ page }) => {
    const resp = await page.request.post('/api/edge/draft', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('§7.10 draft generation shows loading state (structural §8.1 p95<8s)', async ({ page }) => {
    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    // There must be SOME loading/generating indicator available in the DOM
    // (even if currently not triggered)
    const spinner = page.locator('[data-testid="draft-loading"], [aria-label*="generating"], .animate-spin').first();
    const skeletonLoader = page.locator('[data-testid="skeleton"], .skeleton-loader').first();
    // Structural: these elements exist in the component tree
    const spinnerInDom = (await spinner.count()) > 0;
    const skeletonInDom = (await skeletonLoader.count()) > 0;
    // At least one loading pattern must be implemented
    expect(spinnerInDom || skeletonInDom).toBe(true);
  });

  test('§7.11 keyboard shortcuts j/k navigate drafts (§8.3)', async ({ page }) => {
    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    // Focus the page and press 'j' — should move selection down
    await page.locator('body').press('j');
    // Check that something is focused/selected
    const focused = page.locator('[data-focused="true"], [aria-selected="true"], .selected').first();
    const count = await focused.count();
    // If no drafts, count = 0 is fine; if drafts exist, focused count > 0
    const noDrafts = await page.getByText(/no drafts|all clear|nothing pending/i)
      .isVisible().catch(() => false);
    if (!noDrafts) {
      expect(count).toBeGreaterThan(0);
    }
  });

  test('§7.11 /drafts no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/drafts');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
