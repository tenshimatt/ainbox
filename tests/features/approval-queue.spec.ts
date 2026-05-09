/**
 * AINBOX-11 — Approval queue UI at /drafts
 * PRD: §4.5 Component contracts, §5.3 App pages, §7.11 Approval queue, §8.3 Accessibility
 *
 * Verifies:
 * - List renders sorted by confidence DESC
 * - Approve / Reject API calls fire
 * - No horizontal overflow at 375px
 * - Keyboard shortcuts j/k/a/r work
 *
 * No real PII in fixtures (factory-rules.md hard rule #8).
 */

import { test, expect, type Route } from '@playwright/test';

const FIXTURE_DRAFTS = [
  {
    id: 'd-low-1',
    subject: 'Re: synthesised low-confidence question',
    category: 'support',
    confidence: 0.42,
    is_reply: true,
    body: 'placeholder body',
    created_at: '2026-05-01T10:00:00Z',
  },
  {
    id: 'd-high-1',
    subject: 'Re: synthesised pricing enquiry',
    category: 'sales',
    confidence: 0.91,
    is_reply: true,
    body: 'placeholder body',
    created_at: '2026-05-02T10:00:00Z',
  },
  {
    id: 'd-mid-1',
    subject: 'Synthesised meeting request',
    category: 'meeting',
    confidence: 0.72,
    is_reply: false,
    body: 'placeholder body',
    created_at: '2026-05-03T10:00:00Z',
  },
];

async function mockDraftsApi(page: import('@playwright/test').Page) {
  await page.route('**/api/drafts', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ drafts: FIXTURE_DRAFTS }),
    });
  });
}

test.describe('@feature AINBOX-11 approval queue UI', () => {
  test('renders drafts sorted by confidence DESC', async ({ page }) => {
    await mockDraftsApi(page);
    await page.goto('/drafts');

    const cards = page.locator('[data-testid="draft-card"]');
    await expect(cards).toHaveCount(3);

    const ids = await cards.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).getAttribute('data-draft-id')),
    );
    expect(ids).toEqual(['d-high-1', 'd-mid-1', 'd-low-1']);

    const scores = await page
      .locator('[data-testid="confidence-score"]')
      .evaluateAll((els) => els.map((e) => parseFloat((e.textContent ?? '0').replace('%', ''))));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  test('Approve button calls /api/drafts/[id]/approve', async ({ page }) => {
    await mockDraftsApi(page);
    let approveCalled = '';
    await page.route('**/api/drafts/*/approve', async (route: Route) => {
      approveCalled = route.request().url();
      await route.fulfill({ status: 200, body: JSON.stringify({ sent: true }) });
    });

    await page.goto('/drafts');
    await page
      .locator('[data-testid="draft-card"]')
      .first()
      .getByRole('button', { name: /approve/i })
      .click();

    await expect.poll(() => approveCalled).toContain('/api/drafts/d-high-1/approve');
    await expect(page.locator('[data-draft-id="d-high-1"]')).toHaveCount(0);
  });

  test('Reject button calls /api/drafts/[id]/reject', async ({ page }) => {
    await mockDraftsApi(page);
    let rejectCalled = '';
    await page.route('**/api/drafts/*/reject', async (route: Route) => {
      rejectCalled = route.request().url();
      await route.fulfill({ status: 200, body: JSON.stringify({ deleted: true }) });
    });

    await page.goto('/drafts');
    await page
      .locator('[data-testid="draft-card"]')
      .first()
      .getByRole('button', { name: /reject/i })
      .click();

    await expect.poll(() => rejectCalled).toContain('/api/drafts/d-high-1/reject');
    await expect(page.locator('[data-draft-id="d-high-1"]')).toHaveCount(0);
  });

  test('no horizontal overflow at 375px', async ({ page }) => {
    await mockDraftsApi(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/drafts');
    await expect(page.locator('[data-testid="draft-card"]').first()).toBeVisible();
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('keyboard shortcut j moves selection down', async ({ page }) => {
    await mockDraftsApi(page);
    await page.goto('/drafts');
    await page.locator('body').click();
    // First row is selected by default; j should move to second.
    await page.keyboard.press('j');
    await expect(page.locator('[data-draft-id="d-mid-1"]')).toHaveAttribute('data-focused', 'true');
  });

  test('keyboard shortcut k moves selection up', async ({ page }) => {
    await mockDraftsApi(page);
    await page.goto('/drafts');
    await page.locator('body').click();
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await expect(page.locator('[data-draft-id="d-high-1"]')).toHaveAttribute('data-focused', 'true');
  });

  test('keyboard shortcut a approves selected draft', async ({ page }) => {
    await mockDraftsApi(page);
    let approveCalled = '';
    await page.route('**/api/drafts/*/approve', async (route: Route) => {
      approveCalled = route.request().url();
      await route.fulfill({ status: 200, body: JSON.stringify({ sent: true }) });
    });
    await page.goto('/drafts');
    await page.locator('body').click();
    await page.keyboard.press('a');
    await expect.poll(() => approveCalled).toContain('/api/drafts/d-high-1/approve');
  });

  test('keyboard shortcut r rejects selected draft', async ({ page }) => {
    await mockDraftsApi(page);
    let rejectCalled = '';
    await page.route('**/api/drafts/*/reject', async (route: Route) => {
      rejectCalled = route.request().url();
      await route.fulfill({ status: 200, body: JSON.stringify({ deleted: true }) });
    });
    await page.goto('/drafts');
    await page.locator('body').click();
    await page.keyboard.press('r');
    await expect.poll(() => rejectCalled).toContain('/api/drafts/d-high-1/reject');
  });
});
