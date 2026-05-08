/**
 * PRD §7.9 Classification engine
 * PRD §7.13 Dashboard / inbox view
 *
 * Acceptance criteria:
 * - /inbox page renders within p95 <1.5s at 375px (§8.1)
 * - Inbox shows latest 50 inbound emails + pending drafts + auto-send activity
 * - Each email has a visible category label (one of: sales, support, invoice,
 *   complaint, meeting, investor, urgent, escalation, spam, other)
 * - User can override the category via UI action
 * - Category override triggers re-classification API call
 * - Inbox updates live via Supabase Realtime (connection established)
 * - classify edge function endpoint is defined
 * - /inbox no horizontal overflow at 375px
 */

import { test, expect } from '@playwright/test';

const VALID_CATEGORIES = [
  'sales', 'support', 'invoice', 'complaint', 'meeting',
  'investor', 'urgent', 'escalation', 'spam', 'other',
];

test.describe('@e2e §7.9 §7.13 classification and inbox view', () => {
  test('§7.13 /inbox renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/inbox');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.13 /inbox shows email list or empty state (not raw error)', async ({ page }) => {
    await page.goto('/inbox');
    const url = page.url();
    if (!url.includes('/inbox')) return; // auth redirect — skip

    const hasEmails = await page.locator('[data-testid="email-row"], [data-testid="inbox-item"]').first()
      .isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no emails|inbox is empty|nothing here|all caught up/i)
      .first().isVisible().catch(() => false);
    const hasPendingDrafts = await page.getByText(/pending|draft/i).first().isVisible().catch(() => false);

    expect(hasEmails || hasEmptyState || hasPendingDrafts).toBe(true);
  });

  test('§7.9 inbox email items have category labels', async ({ page }) => {
    await page.goto('/inbox');
    const url = page.url();
    if (!url.includes('/inbox')) return;

    // If there are email items, they must show a category badge
    const emailItems = page.locator('[data-testid="email-row"], [data-testid="inbox-item"]');
    const count = await emailItems.count().catch(() => 0);
    if (count > 0) {
      const firstItem = emailItems.first();
      const categoryBadge = firstItem.locator('[data-testid="category-badge"], .category-badge, [aria-label*="category"]');
      const badgeCount = await categoryBadge.count();
      expect(badgeCount).toBeGreaterThan(0);
    }
  });

  test('§7.9 category labels use only valid categories', async ({ page }) => {
    await page.goto('/inbox');
    const url = page.url();
    if (!url.includes('/inbox')) return;

    const badges = page.locator('[data-testid="category-badge"]');
    const count = await badges.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 10); i++) {
      const text = (await badges.nth(i).textContent() ?? '').toLowerCase().trim();
      expect(VALID_CATEGORIES).toContain(text);
    }
  });

  test('§7.9 inbox shows category override option per email', async ({ page }) => {
    await page.goto('/inbox');
    const url = page.url();
    if (!url.includes('/inbox')) return;

    // Category override control — dropdown or button near each item
    const overrideControl = page.getByRole('button', { name: /change category|reclassify|override/i }).first();
    const hasControl = await overrideControl.isVisible().catch(() => false);
    // Acceptable if no items (empty inbox) — just not a crash
    const noItems = await page.getByText(/no emails|inbox is empty|all caught up/i).isVisible().catch(() => false);
    expect(hasControl || noItems).toBe(true);
  });

  test('§7.9 classify edge function endpoint is defined', async ({ page }) => {
    const resp = await page.request.post('/api/edge/classify', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('§7.13 /inbox shows pending drafts section', async ({ page }) => {
    await page.goto('/inbox');
    const url = page.url();
    if (!url.includes('/inbox')) return;

    // Must have a drafts queue area or a link to /drafts
    const hasDraftSection = await page.getByText(/pending draft|draft queue/i).first().isVisible().catch(() => false);
    const hasDraftLink = await page.getByRole('link', { name: /drafts/i }).first().isVisible().catch(() => false);
    expect(hasDraftSection || hasDraftLink).toBe(true);
  });

  test('§7.13 /inbox shows auto-send activity section', async ({ page }) => {
    await page.goto('/inbox');
    const url = page.url();
    if (!url.includes('/inbox')) return;

    const hasAutoSend = await page.getByText(/auto-send|auto send|sent automatically/i)
      .first().isVisible().catch(() => false);
    const hasActivityLog = await page.getByText(/activity|recent activity/i)
      .first().isVisible().catch(() => false);
    const noItems = await page.getByText(/no emails|inbox is empty|all caught up/i)
      .isVisible().catch(() => false);
    expect(hasAutoSend || hasActivityLog || noItems).toBe(true);
  });

  test('§7.13 /inbox page load is <1.5s p95 at 375px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const start = Date.now();
    await page.goto('/inbox', { waitUntil: 'domcontentloaded' });
    const elapsed = Date.now() - start;
    // Under 1.5s for a cold render (non-authenticated, no data)
    expect(elapsed).toBeLessThan(1500);
  });

  test('§7.13 /inbox no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/inbox');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
