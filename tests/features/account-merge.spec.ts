/**
 * AINBOX-49: Merge L2 — /api/account/merge route
 *
 * Tests the handleMergeRequest handler (src/lib/account/merge.ts) with
 * injected deps, following the same mock-injection pattern used by
 * auto-send.spec.ts and email-sync-delta.spec.ts.
 *
 * Coverage:
 *   - Missing / wrong CRON_SECRET → 401 unauthorised.
 *   - Missing primary_user_id → 400.
 *   - Missing secondary_user_id → 400.
 *   - Identical user IDs → 400.
 *   - Invalid JSON body → 400.
 *   - RPC error → 500 with detail.
 *   - Happy path → 200 { ok, tables_reassigned, rows_moved }.
 *   - RPC receives correct primary/secondary args.
 */

import { test, expect } from '@playwright/test';
import { handleMergeRequest, type MergeUsersDeps } from '../../src/lib/account/merge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SECRET = 'test-cron-secret';

function makeDeps(overrides: Partial<MergeUsersDeps> = {}): MergeUsersDeps {
  return {
    validateSecret: (auth) => auth === `Bearer ${VALID_SECRET}`,
    mergeRpc: async () => ({
      data: { ok: true, tables_reassigned: [], rows_moved: 0 },
      error: null,
    }),
    ...overrides,
  };
}

function makeRequest(
  auth = `Bearer ${VALID_SECRET}`,
  body?: unknown,
  method = 'POST',
): Request {
  return new Request('https://app.example.com/api/account/merge', {
    method,
    headers: {
      authorization: auth,
      'content-type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const PRIMARY   = 'aaaaaaaa-0000-0000-0000-000000000001';
const SECONDARY = 'bbbbbbbb-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-49 account merge route', () => {
  test('returns 401 when Authorization header is missing', async () => {
    const res = await handleMergeRequest(makeRequest(''), makeDeps());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorised');
  });

  test('returns 401 when CRON_SECRET is wrong', async () => {
    const res = await handleMergeRequest(makeRequest('Bearer wrong-secret'), makeDeps());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorised');
  });

  test('returns 400 when body is not valid JSON', async () => {
    const req = new Request('https://app.example.com/api/account/merge', {
      method: 'POST',
      headers: { authorization: `Bearer ${VALID_SECRET}`, 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleMergeRequest(req, makeDeps());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_json');
  });

  test('returns 400 when primary_user_id is missing', async () => {
    const res = await handleMergeRequest(
      makeRequest(undefined, { secondary_user_id: SECONDARY }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('primary_user_id_required');
  });

  test('returns 400 when secondary_user_id is missing', async () => {
    const res = await handleMergeRequest(
      makeRequest(undefined, { primary_user_id: PRIMARY }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('secondary_user_id_required');
  });

  test('returns 400 when primary and secondary are the same', async () => {
    const res = await handleMergeRequest(
      makeRequest(undefined, { primary_user_id: PRIMARY, secondary_user_id: PRIMARY }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('user_ids_must_differ');
  });

  test('returns 500 with detail when RPC returns an error', async () => {
    const deps = makeDeps({
      mergeRpc: async () => ({
        data: null,
        error: { message: 'primary_user_id and secondary_user_id must differ' },
      }),
    });
    const res = await handleMergeRequest(
      makeRequest(undefined, { primary_user_id: PRIMARY, secondary_user_id: SECONDARY }),
      deps,
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('merge_failed');
    expect(typeof json.detail).toBe('string');
  });

  test('happy path: returns 200 with merge summary', async () => {
    const rpcResult = {
      ok: true,
      primary_user_id: PRIMARY,
      secondary_user_id: SECONDARY,
      tables_reassigned: ['email_messages', 'kb_items'],
      rows_moved: 42,
    };
    const deps = makeDeps({
      mergeRpc: async () => ({ data: rpcResult, error: null }),
    });
    const res = await handleMergeRequest(
      makeRequest(undefined, { primary_user_id: PRIMARY, secondary_user_id: SECONDARY }),
      deps,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.rows_moved).toBe(42);
    expect(json.tables_reassigned).toContain('email_messages');
  });

  test('RPC is called with the correct primary and secondary user IDs', async () => {
    const calls: Array<{ primary: string; secondary: string }> = [];
    const deps = makeDeps({
      mergeRpc: async (primary, secondary) => {
        calls.push({ primary, secondary });
        return { data: { ok: true, tables_reassigned: [], rows_moved: 0 }, error: null };
      },
    });
    await handleMergeRequest(
      makeRequest(undefined, { primary_user_id: PRIMARY, secondary_user_id: SECONDARY }),
      deps,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].primary).toBe(PRIMARY);
    expect(calls[0].secondary).toBe(SECONDARY);
  });
});
