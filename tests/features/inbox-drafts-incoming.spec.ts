/**
 * TASK7544-24: /inbox 'drafts incoming' banner + Realtime auto-prepend
 *
 * Acceptance criteria:
 * - Banner is hidden on load, appears when a draft INSERT arrives
 * - Banner shows the count of incoming drafts
 * - Banner can be dismissed
 * - Multiple arrivals accumulate the count
 * - Pending-draft rows auto-prepend via the existing realtime mock hook
 * - No horizontal overflow at 375px with banner visible
 *
 * Uses /onboarding/inbox-drafts-incoming-fixture — an unprotected fixture
 * page that renders the DraftsIncomingBanner + LiveSection in isolation so
 * tests run without a live Supabase auth session.
 *
 * Tests wait for data-testid="drafts-incoming-ready" (a hidden sentinel set
 * when the component's useEffect registers the event listener) before
 * dispatching mock events to avoid a hydration race condition.
 */

import { test, expect } from '@playwright/test';

const FIXTURE_URL = '/onboarding/inbox-drafts-incoming-fixture';

/** Wait for DraftsIncomingBanner's useEffect to register its event listener. */
async function waitForReady(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('drafts-incoming-ready')).toBeAttached();
}

test.describe('@feature TASK7544-24 inbox drafts-incoming banner', () => {
  test('banner is hidden on initial load', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await waitForReady(page);
    await expect(page.getByTestId('drafts-incoming-banner')).not.toBeVisible();
    await expect(page.getByTestId('section-pending-drafts')).toBeVisible();
  });

  test('banner appears when a draft arrives via realtime mock', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await waitForReady(page);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('inbox-drafts-incoming-mock'));
    });

    await expect(page.getByTestId('drafts-incoming-banner')).toBeVisible();
    await expect(page.getByTestId('drafts-incoming-banner')).toContainText('1 new draft incoming');
  });

  test('banner accumulates count for multiple draft arrivals', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await waitForReady(page);

    // Dispatch events one at a time so each state update commits before the next,
    // avoiding React batching flattening the three increments into one render.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('inbox-drafts-incoming-mock')));
    await expect(page.getByTestId('drafts-incoming-banner')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('inbox-drafts-incoming-mock')));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('inbox-drafts-incoming-mock')));

    await expect(page.getByTestId('drafts-incoming-banner')).toContainText('3 new drafts incoming');
  });

  test('banner can be dismissed', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await waitForReady(page);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('inbox-drafts-incoming-mock'));
    });

    await expect(page.getByTestId('drafts-incoming-banner')).toBeVisible();

    await page.getByTestId('drafts-incoming-dismiss').click();

    await expect(page.getByTestId('drafts-incoming-banner')).not.toBeVisible();
  });

  test('draft auto-prepends to pending-drafts section', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await waitForReady(page);
    await expect(page.getByTestId('section-pending-drafts')).toBeVisible();

    const section = page.getByTestId('section-pending-drafts');
    const before = await section.getByTestId('section-pending-drafts-row').count();

    // Simulate a Supabase Realtime INSERT via the test hook in LiveSection.
    // Synthesised fixture only — no real email content (per CLAUDE.md PII rule).
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('inbox-realtime-mock', {
          detail: {
            table: 'drafts',
            row: {
              id: 'rt-draft-incoming-1',
              subject: 'Synthetic incoming draft fixture',
              recipient: 'fixture-recipient',
              confidence: 0.92,
              category: 'support',
              status: 'pending',
              updated_at: new Date().toISOString(),
            },
          },
        }),
      );
    });

    await expect
      .poll(async () => section.getByTestId('section-pending-drafts-row').count())
      .toBeGreaterThan(before);

    await expect(section.getByText(/Synthetic incoming draft fixture/)).toBeVisible();
  });

  test('no horizontal overflow at 375px with banner visible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(FIXTURE_URL);
    await waitForReady(page);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('inbox-drafts-incoming-mock'));
    });

    await expect(page.getByTestId('drafts-incoming-banner')).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
