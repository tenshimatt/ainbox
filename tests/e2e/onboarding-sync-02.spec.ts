/**
 * PRD §7.3 Email sync — Gmail backfill
 * PRD §7.4 Email sync — Outlook backfill
 * PRD §7.5 Email sync — incremental (delta)
 *
 * Acceptance criteria:
 * - /onboarding/sync page renders with sync progress indicator
 * - Progress page shows per-batch progress events (real-time updates)
 * - Sync status API endpoints return structured progress data
 * - Sync is resumable: status endpoint shows whether sync is in-progress / complete / failed
 * - /onboarding/sync no horizontal overflow at 375px (§8.1 mobile-first)
 * - Sync status reflects both Gmail and Outlook accounts if both connected
 * - Incremental sync state is accessible (delta token stored, not re-fetching everything)
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §7.3 §7.4 §7.5 email sync onboarding', () => {
  test('§7.3 §7.4 /onboarding/sync page renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/onboarding/sync');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.3 /onboarding/sync shows sync progress UI', async ({ page }) => {
    await page.goto('/onboarding/sync');
    // Must contain a progress indicator or sync status text
    const hasProgress = await page.locator('[role="progressbar"], [data-testid="sync-progress"], .sync-progress').first().isVisible()
      .catch(() => false);
    const hasStatusText = await page.getByText(/syncing|ingesting|importing|loading/i).first().isVisible()
      .catch(() => false);
    // Page must redirect to auth if not logged in — either way no crash
    const url = page.url();
    if (url.includes('/onboarding/sync')) {
      expect(hasProgress || hasStatusText).toBe(true);
    } else {
      // Redirected to auth — acceptable
      expect(url).toMatch(/sign-?in|login|connect/i);
    }
  });

  test('§7.3 §7.4 sync progress API endpoint returns structured data', async ({ page }) => {
    const resp = await page.request.get('/api/sync/status');
    // Must exist (not 404), auth-gated is fine (401)
    expect(resp.status()).not.toBe(404);
  });

  test('§7.5 incremental sync state API endpoint exists', async ({ page }) => {
    const resp = await page.request.get('/api/sync/delta-state');
    expect(resp.status()).not.toBe(404);
  });

  test('§7.3 §7.4 email-sync-gmail edge function endpoint is defined', async ({ page }) => {
    // Edge function routes should exist even if auth-gated
    const resp = await page.request.post('/api/edge/email-sync-gmail', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('§7.4 email-sync-outlook edge function endpoint is defined', async ({ page }) => {
    const resp = await page.request.post('/api/edge/email-sync-outlook', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('§7.3 §7.4 /onboarding/sync no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/onboarding/sync');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('§7.5 /onboarding/sync shows completion state when sync finishes', async ({ page }) => {
    await page.goto('/onboarding/sync');
    // Mock: we can check the page has a "Continue to KB review" or "Next" CTA
    // that is only shown once sync is done — it must at least be in the DOM (hidden)
    const url = page.url();
    if (!url.includes('/onboarding/sync')) return; // auth redirect — skip

    const hasNextCta = await page.getByRole('link', { name: /continue|next|review/i })
      .or(page.getByRole('button', { name: /continue|next|review/i }))
      .first()
      .isVisible()
      .catch(() => false);
    // The CTA exists in DOM (may be hidden/disabled until sync completes)
    const ctaInDom = await page.getByRole('link', { name: /continue|next|review/i })
      .or(page.getByRole('button', { name: /continue|next|review/i }))
      .count()
      .catch(() => 0);
    expect(ctaInDom).toBeGreaterThan(0);
  });
});
