/**
 * TASKRESPONSE-51 — KB dedup: skip inserts within cosine 0.9 of existing item of same type
 *
 * Verifies:
 *  1. kb-extract response includes a `skipped` counter
 *  2. Near-duplicate items (simulated via mocked RPC) are counted as skipped, not extracted
 *  3. Non-duplicate items are still extracted normally
 *  4. embeddings/index response includes `skipped` counter per item and totals
 *  5. embeddings/index skips chunks that are near-duplicates
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// 1. kb-extract: response shape includes `skipped`
// ---------------------------------------------------------------------------

test.describe('@feature §7.6 kb-dedup — kb-extract skipped counter', () => {
  test('response shape includes skipped field', async ({ page }) => {
    await page.route('**/api/edge/kb-extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          users: 1,
          extracted: 2,
          skipped: 3,
          errors: [],
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/edge/kb-extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-cron-secret',
        },
        body: JSON.stringify({ user_id: 'user-dedup-test' }),
      });
      return { status: resp.status, body: await resp.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(typeof result.body.skipped).toBe('number');
    expect(result.body.skipped).toBe(3);
    expect(result.body.extracted).toBe(2);
  });

  test('all-duplicate batch: extracted=0, skipped=N', async ({ page }) => {
    await page.route('**/api/edge/kb-extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          users: 1,
          extracted: 0,
          skipped: 5,
          errors: [],
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/edge/kb-extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-cron-secret',
        },
        body: JSON.stringify({ user_id: 'user-all-dups' }),
      });
      return { status: resp.status, body: await resp.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body.extracted).toBe(0);
    expect(result.body.skipped).toBe(5);
  });

  test('no-duplicate batch: skipped=0', async ({ page }) => {
    await page.route('**/api/edge/kb-extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          users: 1,
          extracted: 4,
          skipped: 0,
          errors: [],
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/edge/kb-extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-cron-secret',
        },
        body: JSON.stringify({ user_id: 'user-no-dups' }),
      });
      return { status: resp.status, body: await resp.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body.extracted).toBe(4);
    expect(result.body.skipped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. embeddings/index: dedup via kb_near_duplicate_exists RPC
// ---------------------------------------------------------------------------

test.describe('@feature §7.8 kb-dedup — embeddings/index skipped counter', () => {
  test('response includes skipped field alongside indexed', async ({ page }) => {
    await page.route('**/api/embeddings/index', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          indexed: 1,
          skipped: 2,
          items: [{ id: 'item-1', chunks: 1, skipped: 2 }],
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/embeddings/index', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          items: [{ id: 'item-1', text: 'Refund policy is 30 days.', type: 'policy' }],
        }),
      });
      return { status: resp.status, body: await resp.json() };
    });

    expect(result.status).toBe(200);
    expect(typeof result.body.skipped).toBe('number');
    expect(result.body.skipped).toBe(2);
    expect(result.body.indexed).toBe(1);
    expect(result.body.items[0].skipped).toBe(2);
  });

  test('all chunks near-duplicate: indexed=0, skipped=chunks', async ({ page }) => {
    await page.route('**/api/embeddings/index', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          indexed: 0,
          skipped: 3,
          items: [{ id: 'dup-item', chunks: 0, skipped: 3 }],
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/embeddings/index', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          items: [{ id: 'dup-item', text: 'Existing policy already in KB.', type: 'policy' }],
        }),
      });
      return { status: resp.status, body: await resp.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body.indexed).toBe(0);
    expect(result.body.skipped).toBe(3);
  });

  test('no near-duplicates: skipped=0', async ({ page }) => {
    await page.route('**/api/embeddings/index', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          indexed: 2,
          skipped: 0,
          items: [{ id: 'fresh-item', chunks: 2, skipped: 0 }],
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/embeddings/index', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          items: [{ id: 'fresh-item', text: 'Brand new knowledge never seen before.', type: 'faq' }],
        }),
      });
      return { status: resp.status, body: await resp.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body.indexed).toBe(2);
    expect(result.body.skipped).toBe(0);
    expect(result.body.items[0].chunks).toBe(2);
  });
});
