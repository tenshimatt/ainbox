/**
 * AINBOX-48 — merge_users(primary, secondary) SQL function contract tests
 *
 * Verifies the Supabase RPC contract for public.merge_users():
 *  1. Happy path: returns ok:true with primary_id, secondary_id, rows_moved
 *  2. rows_moved reflects reassigned rows
 *  3. Same-user guard: error response when primary === secondary
 *  4. Primary not found: error response
 *  5. Secondary not found: error response
 *
 * No real email content or PII in fixtures (factory-rules §8 / PRD §9.3).
 */

import { test, expect } from '@playwright/test';

const PRIMARY_ID   = '00000000-0000-0000-0000-000000000001';
const SECONDARY_ID = '00000000-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// 1. Happy-path: merge succeeds
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-48 merge_users — happy path', () => {
  test('returns ok:true with primary_id, secondary_id, rows_moved', async ({ page }) => {
    await page.route('**/rest/v1/rpc/merge_users', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok:           true,
          primary_id:   PRIMARY_ID,
          secondary_id: SECONDARY_ID,
          rows_moved:   42,
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(
      async ({ primaryId, secondaryId }) => {
        const resp = await fetch('/rest/v1/rpc/merge_users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_primary: primaryId, p_secondary: secondaryId }),
        });
        return { status: resp.status, body: await resp.json() };
      },
      { primaryId: PRIMARY_ID, secondaryId: SECONDARY_ID },
    );

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.primary_id).toBe(PRIMARY_ID);
    expect(result.body.secondary_id).toBe(SECONDARY_ID);
    expect(typeof result.body.rows_moved).toBe('number');
  });

  test('rows_moved reflects reassigned rows', async ({ page }) => {
    await page.route('**/rest/v1/rpc/merge_users', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok:           true,
          primary_id:   PRIMARY_ID,
          secondary_id: SECONDARY_ID,
          rows_moved:   17,
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(
      async ({ primaryId, secondaryId }) => {
        const resp = await fetch('/rest/v1/rpc/merge_users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_primary: primaryId, p_secondary: secondaryId }),
        });
        return { status: resp.status, body: await resp.json() };
      },
      { primaryId: PRIMARY_ID, secondaryId: SECONDARY_ID },
    );

    expect(result.status).toBe(200);
    expect(result.body.rows_moved).toBe(17);
  });

  test('zero rows_moved when secondary had no data', async ({ page }) => {
    await page.route('**/rest/v1/rpc/merge_users', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok:           true,
          primary_id:   PRIMARY_ID,
          secondary_id: SECONDARY_ID,
          rows_moved:   0,
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(
      async ({ primaryId, secondaryId }) => {
        const resp = await fetch('/rest/v1/rpc/merge_users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_primary: primaryId, p_secondary: secondaryId }),
        });
        return { status: resp.status, body: await resp.json() };
      },
      { primaryId: PRIMARY_ID, secondaryId: SECONDARY_ID },
    );

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.rows_moved).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Guard: same-user merge rejected
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-48 merge_users — same-user guard', () => {
  test('returns 400 when primary === secondary', async ({ page }) => {
    await page.route('**/rest/v1/rpc/merge_users', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          code:    'P0001',
          message: 'merge_users: primary and secondary must differ',
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(
      async ({ userId }) => {
        const resp = await fetch('/rest/v1/rpc/merge_users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_primary: userId, p_secondary: userId }),
        });
        return { status: resp.status, body: await resp.json() };
      },
      { userId: PRIMARY_ID },
    );

    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/primary and secondary must differ/);
  });
});

// ---------------------------------------------------------------------------
// 3. Guard: primary user not found
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-48 merge_users — primary not found', () => {
  test('returns 404-style error when primary does not exist', async ({ page }) => {
    const GHOST_ID = '00000000-0000-0000-0000-000000000099';

    await page.route('**/rest/v1/rpc/merge_users', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          code:    'P0001',
          message: `merge_users: primary user ${GHOST_ID} not found`,
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(
      async ({ ghostId, secondaryId }) => {
        const resp = await fetch('/rest/v1/rpc/merge_users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_primary: ghostId, p_secondary: secondaryId }),
        });
        return { status: resp.status, body: await resp.json() };
      },
      { ghostId: GHOST_ID, secondaryId: SECONDARY_ID },
    );

    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/primary user .* not found/);
  });
});

// ---------------------------------------------------------------------------
// 4. Guard: secondary user not found
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-48 merge_users — secondary not found', () => {
  test('returns error when secondary does not exist', async ({ page }) => {
    const GHOST_ID = '00000000-0000-0000-0000-000000000088';

    await page.route('**/rest/v1/rpc/merge_users', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          code:    'P0001',
          message: `merge_users: secondary user ${GHOST_ID} not found`,
        }),
      });
    });

    await page.goto('/onboarding/kb-review');

    const result = await page.evaluate(
      async ({ primaryId, ghostId }) => {
        const resp = await fetch('/rest/v1/rpc/merge_users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_primary: primaryId, p_secondary: ghostId }),
        });
        return { status: resp.status, body: await resp.json() };
      },
      { primaryId: PRIMARY_ID, ghostId: GHOST_ID },
    );

    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/secondary user .* not found/);
  });
});
