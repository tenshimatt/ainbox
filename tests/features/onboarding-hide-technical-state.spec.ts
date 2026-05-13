/**
 * AINBOX-57 — Onboarding: hide ALL backend percentages + technical state
 * PRD: §7.3 §7.5 §7.6
 */

import { test, expect } from '@playwright/test';

// ─── Sync page ────────────────────────────────────────────────────────────────

test.describe('@feature AINBOX-57 sync page hides technical state', () => {
  test('progress bar shows no percentage number', async ({ page }) => {
    await page.goto('/onboarding/sync');
    const url = page.url();
    if (!url.includes('/onboarding/sync')) return; // auth redirect — skip

    const progressEl = page.getByTestId('sync-progress');
    await expect(progressEl).toBeVisible({ timeout: 5000 });

    const text = await progressEl.textContent();
    // Must not expose a raw percentage like "23%" or "0%"
    expect(text).not.toMatch(/\d+%/);
  });

  test('sync page does not show raw backend counters (Classified / KB items)', async ({ page }) => {
    await page.goto('/onboarding/sync');
    const url = page.url();
    if (!url.includes('/onboarding/sync')) return;

    // The technical counter grid must not be rendered
    await expect(page.getByTestId('sync-counters')).toHaveCount(0);
  });

  test('sync page does not show "Sync events" log panel', async ({ page }) => {
    await page.goto('/onboarding/sync');
    const url = page.url();
    if (!url.includes('/onboarding/sync')) return;

    // The batch events heading must not appear
    const eventsHeading = page.getByText(/sync events/i);
    await expect(eventsHeading).toHaveCount(0);
  });

  test('sync step labels are user-friendly, not technical', async ({ page }) => {
    await page.goto('/onboarding/sync');
    const url = page.url();
    if (!url.includes('/onboarding/sync')) return;

    // Technical labels that must NOT appear
    await expect(page.getByText(/classifying emails/i)).toHaveCount(0);
    await expect(page.getByText(/extracting knowledge/i)).toHaveCount(0);
    await expect(page.getByText(/fetching email metadata/i)).toHaveCount(0);
    await expect(page.getByText(/connecting to provider/i)).toHaveCount(0);

    // Friendly labels that MUST appear
    await expect(page.getByText(/reading your emails/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/building your assistant/i)).toBeVisible();
  });
});

// ─── KB review page ────────────────────────────────────────────────────────────

function makeItem(
  id: string,
  type: string,
  content: string,
  confidence = 0.92,
  human_verified = false,
) {
  return { id, type, content, confidence, source_email_id: `email-${id}`, human_verified };
}

function makeListResponse(items: ReturnType<typeof makeItem>[]) {
  const grouped: Record<string, typeof items> = {
    faq: [],
    policy: [],
    pricing: [],
    preference: [],
    contact: [],
    signature: [],
    'tone-sample': [],
  };
  for (const it of items) {
    if (grouped[it.type]) grouped[it.type].push(it);
  }
  return { ok: true, page: 1, pageSize: 50, total: items.length, items, grouped };
}

test.describe('@feature AINBOX-57 KB review page hides confidence scores', () => {
  test('confidence percentage is not shown on KB items', async ({ page }) => {
    const items = [
      makeItem('k1', 'policy', 'Refunds are processed within 5 days.', 0.95),
      makeItem('k2', 'faq', 'We offer 24/7 support.', 0.78),
    ];

    await page.route('**/api/kb/items', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeListResponse(items)),
      });
    });

    await page.route('**/api/kb/extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, extracted: 0 }),
      });
    });

    await page.goto('/onboarding/kb-review');
    await expect(page.getByTestId('kb-item-k1')).toBeVisible({ timeout: 5000 });

    const pageText = await page.locator('body').textContent();
    // Must not expose raw confidence percentages like "95%" or "78%"
    expect(pageText).not.toMatch(/\bconfidence\s+\d+%/i);
    expect(pageText).not.toMatch(/\b9[0-9]%/);
    expect(pageText).not.toMatch(/\b7[0-9]%/);
  });

  test('"verified" label is still shown for approved items without a percentage', async ({
    page,
  }) => {
    const items = [makeItem('v1', 'policy', 'No returns after 60 days.', 0.9, true)];

    await page.route('**/api/kb/items', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeListResponse(items)),
      });
    });

    await page.route('**/api/kb/extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, extracted: 0 }),
      });
    });

    await page.goto('/onboarding/kb-review');
    const card = page.getByTestId('kb-item-v1');
    await expect(card).toBeVisible({ timeout: 5000 });

    // "verified" label must still appear
    await expect(card.getByText(/verified/i)).toBeVisible();

    // But no raw percentage
    const cardText = await card.textContent();
    expect(cardText).not.toMatch(/\d+%/);
  });
});
