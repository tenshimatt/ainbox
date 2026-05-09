/**
 * PRD §5.3 App pages — `/inbox` (live triage view + draft queue)
 * PRD §7.13 Dashboard / inbox view
 *
 * Acceptance criteria covered:
 * - Three sections render: Latest inbound, Pending drafts, Recent activity
 * - Realtime update appends/upserts a row into the appropriate section
 * - No horizontal overflow at 375px viewport
 * - API/Realtime are mocked — test does not require a live Supabase backend
 */

import { test, expect } from '@playwright/test';

test.describe('@feature §5.3 §7.13 inbox dashboard', () => {
  test('renders the three sections', async ({ page }) => {
    const resp = await page.goto('/inbox');
    expect(resp?.status()).toBeLessThan(500);

    await expect(page.getByTestId('section-inbound')).toBeVisible();
    await expect(page.getByTestId('section-pending-drafts')).toBeVisible();
    await expect(page.getByTestId('section-recent-activity')).toBeVisible();

    // Section titles must be present and human-readable (PRD §7.13)
    await expect(page.getByRole('heading', { name: /latest inbound/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /pending drafts/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /recent activity/i })).toBeVisible();
  });

  test('realtime update appends a row to a section', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByTestId('section-inbound')).toBeVisible();

    // Capture rows before the simulated realtime event.
    const inbound = page.getByTestId('section-inbound');
    const before = await inbound.getByTestId('section-inbound-row').count();

    // Simulate a Supabase Realtime INSERT via the test hook in LiveSection.
    // Synthesised fixture only — no real email content (per CLAUDE.md PII rule).
    await page.evaluate(() => {
      const evt = new CustomEvent('inbox-realtime-mock', {
        detail: {
          table: 'email_messages',
          row: {
            id: 'rt-test-row-1',
            subject: 'Synthetic realtime fixture',
            from_address: 'fixture-sender',
            received_at: new Date().toISOString(),
            category: 'support',
          },
        },
      });
      window.dispatchEvent(evt);
    });

    // The new row should appear at the top of the inbound section.
    await expect.poll(async () => inbound.getByTestId('section-inbound-row').count())
      .toBeGreaterThan(before);

    await expect(inbound.getByText(/Synthetic realtime fixture/)).toBeVisible();
  });

  test('no horizontal overflow at 375px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/inbox');
    await expect(page.getByTestId('inbox-dashboard')).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);

    const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(docWidth).toBeLessThanOrEqual(375);
  });
});
