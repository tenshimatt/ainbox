/**
 * TASKRESPONSE-54 — KB review UX pass: friendly errors, bulk approve, branching empty states
 * PRD: §7.7
 */

import { test, expect } from '@playwright/test';

// Shared item fixture factory
function makeItem(
  id: string,
  type: string,
  content: string,
  human_verified = false,
) {
  return {
    id,
    type,
    content,
    confidence: 0.85,
    source_email_id: `email-${id}`,
    human_verified,
  };
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
  return {
    ok: true,
    page: 1,
    pageSize: 50,
    total: items.length,
    items,
    grouped,
  };
}

// ─── Friendly errors ──────────────────────────────────────────────────────────

test.describe('@feature TASKRESPONSE-54 friendly error messages', () => {
  test('shows friendly message when list API returns 500', async ({ page }) => {
    await page.route('**/api/kb/items', async (route) => {
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });
    await page.route('**/api/kb/extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, extracted: 0 }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const alert = page.getByTestId('kb-error');
    await expect(alert).toBeVisible({ timeout: 5000 });

    // Must NOT expose raw status codes to the user
    const text = await alert.textContent();
    expect(text).not.toMatch(/list 500/i);
    expect(text).not.toMatch(/\b500\b/);

    // Must be a human-readable message
    expect(text).toMatch(/couldn.t load|failed to load|try refresh/i);
  });

  test('shows friendly message when extract API returns 500', async ({ page }) => {
    const store: ReturnType<typeof makeItem>[] = [];

    await page.route('**/api/kb/items', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeListResponse(store)),
      });
    });

    let extractCalled = false;
    await page.route('**/api/kb/extract', async (route) => {
      if (!extractCalled) {
        // First call (auto-trigger) succeeds with no items to avoid loop
        extractCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, extracted: 0 }),
        });
        return;
      }
      // Manual run extraction click → 500
      await route.fulfill({ status: 500, body: 'Server error' });
    });

    await page.goto('/onboarding/kb-review');
    // Wait for the auto-trigger to fully complete (post-extract state shows = no in-flight calls)
    await expect(page.getByTestId('kb-empty-done')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('kb-extract-button').click();

    const alert = page.getByTestId('kb-error');
    await expect(alert).toBeVisible({ timeout: 5000 });

    const text = await alert.textContent();
    expect(text).not.toMatch(/extract 500/i);
    expect(text).not.toMatch(/\b500\b/);
    expect(text).toMatch(/extraction|try again|error/i);
  });

  test('shows friendly message when approve API returns 500', async ({ page }) => {
    const item = makeItem('item-1', 'policy', 'Refund window is 30 days.');
    const store = [item];

    await page.route('**/api/kb/items', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeListResponse([...store])),
      });
    });

    await page.route('**/api/kb/extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, extracted: 0 }),
      });
    });

    await page.route('**/api/kb/items/*', async (route) => {
      await route.fulfill({ status: 500, body: 'Server error' });
    });

    await page.goto('/onboarding/kb-review');

    await expect(page.getByTestId(`kb-approve-${item.id}`)).toBeVisible({ timeout: 5000 });
    await page.getByTestId(`kb-approve-${item.id}`).click();

    const alert = page.getByTestId('kb-error');
    await expect(alert).toBeVisible({ timeout: 5000 });

    const text = await alert.textContent();
    expect(text).not.toMatch(/patch 500/i);
    expect(text).toMatch(/couldn.t save|approval|try again/i);
  });

  test('error is rendered as an alert div, not a plain paragraph', async ({ page }) => {
    await page.route('**/api/kb/items', async (route) => {
      await route.fulfill({ status: 503, body: 'Service Unavailable' });
    });
    await page.route('**/api/kb/extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const alert = page.getByRole('alert').filter({ hasText: /couldn.t load|failed|refresh/i });
    await expect(alert).toBeVisible({ timeout: 5000 });
  });
});

// ─── Bulk approve ─────────────────────────────────────────────────────────────

test.describe('@feature TASKRESPONSE-54 bulk approve', () => {
  test('Approve all button is visible when unverified items exist', async ({ page }) => {
    const items = [
      makeItem('p1', 'policy', 'Policy A'),
      makeItem('p2', 'policy', 'Policy B'),
      makeItem('p3', 'pricing', 'Price C'),
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

    await expect(page.getByTestId('kb-bulk-approve')).toBeVisible({ timeout: 5000 });
    const text = await page.getByTestId('kb-bulk-approve').textContent();
    expect(text).toMatch(/approve all/i);
    expect(text).toContain('3'); // shows unverified count
  });

  test('Approve all button is hidden when all items are already verified', async ({ page }) => {
    const items = [
      makeItem('p1', 'policy', 'Policy A', true),
      makeItem('p2', 'pricing', 'Price B', true),
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

    await expect(page.getByTestId('kb-group-policy')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('kb-bulk-approve')).toHaveCount(0);
  });

  test('clicking Approve all sends PATCH for every unverified item', async ({ page }) => {
    const store = [
      makeItem('x1', 'faq', 'FAQ one'),
      makeItem('x2', 'faq', 'FAQ two'),
      makeItem('x3', 'policy', 'Policy one'),
    ];

    const patchedIds: string[] = [];

    await page.route('**/api/kb/items', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeListResponse([...store])),
      });
    });

    await page.route('**/api/kb/extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, extracted: 0 }),
      });
    });

    await page.route('**/api/kb/items/*', async (route) => {
      const url = new URL(route.request().url());
      const id = url.pathname.split('/').pop()!;
      const method = route.request().method();
      if (method === 'PATCH') {
        patchedIds.push(id);
        const idx = store.findIndex((s) => s.id === id);
        if (idx >= 0) store[idx] = { ...store[idx], human_verified: true };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, item: store[idx] }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/onboarding/kb-review');

    const bulkBtn = page.getByTestId('kb-bulk-approve');
    await expect(bulkBtn).toBeVisible({ timeout: 5000 });
    await bulkBtn.click();

    // Wait for button to disappear (all approved → unverifiedCount === 0)
    await expect(bulkBtn).toHaveCount(0, { timeout: 5000 });

    // All 3 items should have been patched
    expect(patchedIds.sort()).toEqual(['x1', 'x2', 'x3'].sort());

    // Each item card should now show "Approved"
    for (const item of store) {
      await expect(page.getByTestId(`kb-approve-${item.id}`)).toHaveText(/Approved/);
    }
  });

  test('per-section Approve all button appears when section has >1 unverified items', async ({
    page,
  }) => {
    const items = [
      makeItem('f1', 'faq', 'FAQ one'),
      makeItem('f2', 'faq', 'FAQ two'),
      makeItem('p1', 'policy', 'Policy one'), // only 1 unverified policy
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

    await page.route('**/api/kb/items/*', async (route) => {
      await route.fallback();
    });

    await page.goto('/onboarding/kb-review');

    await expect(page.getByTestId('kb-group-faq')).toBeVisible({ timeout: 5000 });

    // FAQs section has 2 unverified → section bulk button shown
    await expect(page.getByTestId('kb-bulk-approve-faq')).toBeVisible();

    // Policy section has only 1 unverified → no section bulk button
    await expect(page.getByTestId('kb-bulk-approve-policy')).toHaveCount(0);
  });
});

// ─── Branching empty states ──────────────────────────────────────────────────

test.describe('@feature TASKRESPONSE-54 branching empty states', () => {
  test('shows pre-extract empty state before any extraction has run', async ({ page }) => {
    // Return empty items and make extract hang so we can observe the intermediate state
    await page.route('**/api/kb/items', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeListResponse([])),
      });
    });

    // Auto-triggered extract: respond slowly so we can observe the extracting state
    await page.route('**/api/kb/extract', async (route) => {
      // Never fulfills within the check window — simulates in-progress extraction
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, extracted: 0 }),
      });
    });

    await page.goto('/onboarding/kb-review');

    // While auto-extract is pending, should show both the base empty state and the
    // extracting progress indicator (they coexist during active extraction)
    await expect(page.getByTestId('kb-empty-extracting')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('kb-empty')).toBeVisible();
  });

  test('shows post-extract empty state when extraction completes with no items', async ({
    page,
  }) => {
    await page.route('**/api/kb/items', async (route) => {
      // Return empty list always
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeListResponse([])),
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

    // After extraction completes (auto-trigger), show the post-extract empty state
    // (kb-empty-done) which has more helpful guidance than the pre-extract kb-empty.
    await expect(page.getByTestId('kb-empty-done')).toBeVisible({ timeout: 8000 });

    const text = await page.getByTestId('kb-empty-done').textContent();
    // Post-extract empty state is more specific than the pre-extract one
    expect(text).toMatch(/couldn.t find|pattern|sync more|try again/i);
  });

  test('extracting empty state contains a progress indicator, not just text', async ({ page }) => {
    await page.route('**/api/kb/items', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeListResponse([])),
      });
    });

    // Hang the extract call so we observe the extracting state
    await page.route('**/api/kb/extract', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/onboarding/kb-review');

    const extractingEl = page.getByTestId('kb-empty-extracting');
    await expect(extractingEl).toBeVisible({ timeout: 5000 });

    // Should contain a visual progress element (div with animate-pulse or similar)
    const progressBar = extractingEl.locator('div.animate-pulse');
    await expect(progressBar).toBeVisible();
  });

  test('empty state is not shown when items exist', async ({ page }) => {
    const items = [makeItem('i1', 'policy', 'Some policy content')];

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

    await expect(page.getByTestId('kb-group-policy')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('kb-empty')).toHaveCount(0);
    await expect(page.getByTestId('kb-empty-extracting')).toHaveCount(0);
  });
});
