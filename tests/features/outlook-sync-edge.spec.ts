/**
 * TASKRESPONSE-20 — /api/edge/email-sync-outlook edge trigger
 * PRD §3.8 §4.2 §4.3 §7.4 §7.5 §7.17 §7.18
 *
 * Tests the HTTP contract of the edge function trigger:
 *  - Returns 401 when no valid session cookie is present (§4.1, §3.9)
 *  - Returns non-404 for a well-formed unauthenticated POST (endpoint exists)
 *  - Response body is structured JSON with an `ok` field
 *
 * Note: integration tests against a real Supabase/Graph backend are out of
 * scope for the feature test lane. The sync worker internals are covered by
 * outlook-sync.spec.ts. This file only exercises the HTTP surface of the edge
 * function route.
 */

import { test, expect } from '@playwright/test';

const EDGE_URL = '/api/edge/email-sync-outlook';

test.describe('@feature §7.4 §7.5 TASKRESPONSE-20 outlook edge trigger', () => {
  test('endpoint exists and does not return 404', async ({ page }) => {
    const resp = await page.request.post(EDGE_URL, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('returns 401 when called without a session (§4.1 auth gate)', async ({ page }) => {
    // Request with no cookies — should be rejected as unauthenticated.
    const resp = await page.request.post(EDGE_URL, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('response body is valid JSON with an ok field', async ({ page }) => {
    const resp = await page.request.post(EDGE_URL, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await resp.json();
    expect(typeof body.ok).toBe('boolean');
  });

  test('unauthenticated response contains structured error payload', async ({ page }) => {
    const resp = await page.request.post(EDGE_URL, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });
});
