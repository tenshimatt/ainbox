/**
 * AINBOX-30: §7.5 Email sync — incremental delta (edge function + pg_cron).
 *
 * PRD: §7.5  Email sync — incremental delta
 *      §4.1  Auth model — CRON_SECRET bearer (service-role exception)
 *      §7.3  Gmail incremental anchored by historyId
 *      §7.4  Outlook incremental anchored by deltaToken
 *
 * Tests target the Node-compatible handler module
 * (`supabase/functions/email-sync-delta/handler.ts`) using the same
 * mock-injection pattern as the auto-send feature spec.
 *
 * Coverage:
 *   - CRON_SECRET validation → 401 when missing or wrong.
 *   - OPTIONS preflight → 200 with CORS headers.
 *   - Non-POST methods → 405.
 *   - Batch limit capped at DELTA_BATCH_LIMIT.
 *   - Gmail users dispatched to runGmailIncremental with correct historyId.
 *   - Outlook users dispatched to runOutlookIncremental with correct deltaToken.
 *   - Per-user error isolation — one failure does not abort the batch.
 *   - Response shape: { ok, examined, synced, errors, detail }.
 *   - Empty ready-users list → { ok, examined:0, synced:0, errors:0 }.
 *   - synced count incremented correctly for processed>0 cases.
 */

import { test, expect } from '@playwright/test';
import {
  handleDeltaSyncRequest,
  DELTA_BATCH_LIMIT,
  type DeltaSyncDeps,
  type ReadyUserRow,
  type ProviderResult,
} from '../../supabase/functions/email-sync-delta/handler';

// ---------------------------------------------------------------------------
// Helpers: fake deps builder
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<DeltaSyncDeps> = {}): DeltaSyncDeps {
  return {
    validateSecret: (h) => h === 'Bearer test-secret',
    fetchReadyUsers: async () => [],
    runGmailIncremental: async () => ({ processed: 0, newHistoryId: null }),
    runOutlookIncremental: async () => ({ processed: 0, newDeltaToken: null }),
    ...overrides,
  };
}

function makeRequest(method = 'POST', auth = 'Bearer test-secret', body?: unknown): Request {
  return new Request('https://edge.example.com/functions/v1/email-sync-delta', {
    method,
    headers: {
      authorization: auth,
      'content-type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function gmailUser(i: number): ReadyUserRow {
  return {
    user_id: `gmail-user-${i}`,
    provider: 'gmail',
    history_id: `10000${i}`,
    delta_token: null,
  };
}

function outlookUser(i: number): ReadyUserRow {
  return {
    user_id: `outlook-user-${i}`,
    provider: 'outlook',
    history_id: null,
    delta_token: `https://graph.microsoft.com/v1.0/me/messages/delta?$skiptoken=tok${i}`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-30 §7.5 email-sync-delta handler', () => {

  // ── Auth ──────────────────────────────────────────────────────────────────

  test('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('POST', '');
    const res = await handleDeltaSyncRequest(req, makeDeps());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorised');
  });

  test('returns 401 when Authorization header has wrong secret', async () => {
    const req = makeRequest('POST', 'Bearer wrong-secret');
    const res = await handleDeltaSyncRequest(req, makeDeps());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorised');
  });

  test('returns 401 when validateSecret returns false', async () => {
    const req = makeRequest('POST', 'Bearer test-secret');
    const deps = makeDeps({ validateSecret: () => false });
    const res = await handleDeltaSyncRequest(req, deps);
    expect(res.status).toBe(401);
  });

  // ── Method handling ───────────────────────────────────────────────────────

  test('returns 405 for GET requests', async () => {
    const req = makeRequest('GET', 'Bearer test-secret');
    const res = await handleDeltaSyncRequest(req, makeDeps());
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toBe('method_not_allowed');
  });

  test('returns 405 for PUT requests', async () => {
    const req = makeRequest('PUT', 'Bearer test-secret');
    const res = await handleDeltaSyncRequest(req, makeDeps());
    expect(res.status).toBe(405);
  });

  test('OPTIONS preflight returns 200 with CORS headers', async () => {
    const req = new Request('https://edge.example.com/functions/v1/email-sync-delta', {
      method: 'OPTIONS',
    });
    const res = await handleDeltaSyncRequest(req, makeDeps());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  // ── Empty batch ───────────────────────────────────────────────────────────

  test('returns ok summary when no ready users found', async () => {
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const deps = makeDeps({ fetchReadyUsers: async () => [] });
    const res = await handleDeltaSyncRequest(req, deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.examined).toBe(0);
    expect(body.synced).toBe(0);
    expect(body.errors).toBe(0);
    expect(body.detail.results).toEqual([]);
  });

  // ── Batch limit ───────────────────────────────────────────────────────────

  test('DELTA_BATCH_LIMIT constant is 50', () => {
    expect(DELTA_BATCH_LIMIT).toBe(50);
  });

  test('batch limit is capped at DELTA_BATCH_LIMIT even when body requests more', async () => {
    let capturedLimit = 0;
    const deps = makeDeps({
      fetchReadyUsers: async (limit) => {
        capturedLimit = limit;
        return [];
      },
    });
    const req = makeRequest('POST', 'Bearer test-secret', { limit: 9999 });
    await handleDeltaSyncRequest(req, deps);
    expect(capturedLimit).toBeLessThanOrEqual(DELTA_BATCH_LIMIT);
  });

  test('custom limit below DELTA_BATCH_LIMIT is honoured', async () => {
    let capturedLimit = 0;
    const deps = makeDeps({
      fetchReadyUsers: async (limit) => {
        capturedLimit = limit;
        return [];
      },
    });
    const req = makeRequest('POST', 'Bearer test-secret', { limit: 10 });
    await handleDeltaSyncRequest(req, deps);
    expect(capturedLimit).toBe(10);
  });

  test('default limit is DELTA_BATCH_LIMIT when body is empty', async () => {
    let capturedLimit = 0;
    const deps = makeDeps({
      fetchReadyUsers: async (limit) => {
        capturedLimit = limit;
        return [];
      },
    });
    const req = makeRequest('POST', 'Bearer test-secret');
    await handleDeltaSyncRequest(req, deps);
    expect(capturedLimit).toBe(DELTA_BATCH_LIMIT);
  });

  // ── Gmail incremental dispatch ────────────────────────────────────────────

  test('dispatches Gmail users to runGmailIncremental with correct historyId', async () => {
    const calls: Array<{ userId: string; historyId: string }> = [];
    const deps = makeDeps({
      fetchReadyUsers: async () => [gmailUser(1)],
      runGmailIncremental: async (userId, historyId) => {
        calls.push({ userId, historyId });
        return { processed: 3, newHistoryId: '100011' };
      },
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBe('gmail-user-1');
    expect(calls[0].historyId).toBe('100001');
  });

  test('Gmail result included in detail with correct processed count', async () => {
    const deps = makeDeps({
      fetchReadyUsers: async () => [gmailUser(2)],
      runGmailIncremental: async () => ({ processed: 5, newHistoryId: '999' }),
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    const body = await res.json();
    const result: ProviderResult = body.detail.results[0];
    expect(result.userId).toBe('gmail-user-2');
    expect(result.provider).toBe('gmail');
    expect(result.processed).toBe(5);
    expect(result.error).toBeUndefined();
  });

  // ── Outlook incremental dispatch ──────────────────────────────────────────

  test('dispatches Outlook users to runOutlookIncremental with correct deltaToken', async () => {
    const calls: Array<{ userId: string; deltaToken: string }> = [];
    const deps = makeDeps({
      fetchReadyUsers: async () => [outlookUser(1)],
      runOutlookIncremental: async (userId, deltaToken) => {
        calls.push({ userId, deltaToken });
        return { processed: 2, newDeltaToken: 'new-delta-tok1' };
      },
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBe('outlook-user-1');
    expect(calls[0].deltaToken).toContain('tok1');
  });

  test('Outlook result included in detail with correct processed count', async () => {
    const deps = makeDeps({
      fetchReadyUsers: async () => [outlookUser(3)],
      runOutlookIncremental: async () => ({ processed: 7, newDeltaToken: 'new-tok' }),
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    const body = await res.json();
    const result: ProviderResult = body.detail.results[0];
    expect(result.userId).toBe('outlook-user-3');
    expect(result.provider).toBe('outlook');
    expect(result.processed).toBe(7);
    expect(result.error).toBeUndefined();
  });

  // ── Mixed providers ───────────────────────────────────────────────────────

  test('handles mixed Gmail + Outlook users in same batch', async () => {
    const gmailCalls: string[] = [];
    const outlookCalls: string[] = [];
    const deps = makeDeps({
      fetchReadyUsers: async () => [gmailUser(10), outlookUser(20), gmailUser(11)],
      runGmailIncremental: async (userId) => {
        gmailCalls.push(userId);
        return { processed: 1, newHistoryId: 'h-new' };
      },
      runOutlookIncremental: async (userId) => {
        outlookCalls.push(userId);
        return { processed: 2, newDeltaToken: 'd-new' };
      },
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.examined).toBe(3);
    expect(gmailCalls).toEqual(['gmail-user-10', 'gmail-user-11']);
    expect(outlookCalls).toEqual(['outlook-user-20']);
    expect(body.detail.results).toHaveLength(3);
  });

  // ── Per-user error isolation ──────────────────────────────────────────────

  test('per-user error does not abort the batch — remaining users still processed', async () => {
    const processed: string[] = [];
    const deps = makeDeps({
      fetchReadyUsers: async () => [gmailUser(1), gmailUser(2), gmailUser(3)],
      runGmailIncremental: async (userId) => {
        if (userId === 'gmail-user-2') throw new Error('transient network error');
        processed.push(userId);
        return { processed: 1, newHistoryId: 'h-new' };
      },
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.examined).toBe(3);
    expect(body.errors).toBe(1);
    // Users 1 and 3 must still have been processed.
    expect(processed).toContain('gmail-user-1');
    expect(processed).toContain('gmail-user-3');
  });

  test('failed user result contains error message in detail', async () => {
    const deps = makeDeps({
      fetchReadyUsers: async () => [gmailUser(5)],
      runGmailIncremental: async () => {
        throw new Error('Gmail not connected — no oauth token found');
      },
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    const body = await res.json();
    const result: ProviderResult = body.detail.results[0];
    expect(result.error).toContain('Gmail not connected');
    expect(result.processed).toBe(0);
  });

  test('all users failing still returns ok:true with errors count', async () => {
    const deps = makeDeps({
      fetchReadyUsers: async () => [gmailUser(1), outlookUser(2)],
      runGmailIncremental: async () => { throw new Error('gmail err'); },
      runOutlookIncremental: async () => { throw new Error('outlook err'); },
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.errors).toBe(2);
    expect(body.synced).toBe(0);
  });

  // ── synced count logic ────────────────────────────────────────────────────

  test('synced incremented when processed > 0 (even if newHistoryId is null)', async () => {
    const deps = makeDeps({
      fetchReadyUsers: async () => [gmailUser(1)],
      runGmailIncremental: async () => ({ processed: 4, newHistoryId: null }),
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    const body = await res.json();
    expect(body.synced).toBe(1);
  });

  test('synced incremented when newHistoryId returned (even processed=0)', async () => {
    const deps = makeDeps({
      fetchReadyUsers: async () => [gmailUser(1)],
      runGmailIncremental: async () => ({ processed: 0, newHistoryId: 'h-new' }),
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    const body = await res.json();
    expect(body.synced).toBe(1);
  });

  test('synced NOT incremented when processed=0 AND newHistoryId is null', async () => {
    const deps = makeDeps({
      fetchReadyUsers: async () => [gmailUser(1)],
      runGmailIncremental: async () => ({ processed: 0, newHistoryId: null }),
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, deps);
    const body = await res.json();
    expect(body.synced).toBe(0);
  });

  // ── Response shape ────────────────────────────────────────────────────────

  test('response Content-Type is application/json', async () => {
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, makeDeps());
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  test('response has all required top-level fields', async () => {
    const req = makeRequest('POST', 'Bearer test-secret', {});
    const res = await handleDeltaSyncRequest(req, makeDeps());
    const body = await res.json();
    expect(typeof body.ok).toBe('boolean');
    expect(typeof body.examined).toBe('number');
    expect(typeof body.synced).toBe('number');
    expect(typeof body.errors).toBe('number');
    expect(body.detail).toBeDefined();
    expect(Array.isArray(body.detail.results)).toBe(true);
  });

  // ── fetchReadyUsers throws ────────────────────────────────────────────────

  test('propagates error when fetchReadyUsers throws', async () => {
    const deps = makeDeps({
      fetchReadyUsers: async () => { throw new Error('DB connection failed'); },
    });
    const req = makeRequest('POST', 'Bearer test-secret', {});
    await expect(handleDeltaSyncRequest(req, deps)).rejects.toThrow('DB connection failed');
  });
});
