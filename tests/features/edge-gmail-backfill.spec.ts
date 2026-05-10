/**
 * AINBOX-26: Edge Function handler spec — email-sync-gmail.
 *
 * PRD anchors: §4.6 (edge function), §7.3 (Gmail backfill).
 *
 * Strategy:
 *   `handleEdgeBackfill` in handler.ts has an injectable `deps` interface
 *   so we can test the HTTP-layer contract (auth, token lookup, backfill dispatch)
 *   without a live Supabase instance or Deno runtime. Same pattern as
 *   tests/features/gmail-sync.spec.ts for the core worker.
 */

import { test, expect } from '@playwright/test';
import {
  handleEdgeBackfill,
  type EdgeBackfillDeps,
  type BackfillResult,
} from '../../supabase/functions/email-sync-gmail/handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_USER_ID = 'user-edge-fixture-001';
const FIXTURE_REFRESH_TOKEN = 'rt-fixture-not-a-real-token';
const VALID_AUTH_HEADER = 'Bearer fixture-jwt-valid';

function makeDeps(overrides: Partial<EdgeBackfillDeps> = {}): EdgeBackfillDeps {
  return {
    async verifyAuth(header) {
      return header === VALID_AUTH_HEADER ? FIXTURE_USER_ID : null;
    },
    async loadRefreshToken(userId) {
      return userId === FIXTURE_USER_ID ? FIXTURE_REFRESH_TOKEN : null;
    },
    async runBackfill(_userId, _refreshToken): Promise<BackfillResult> {
      return { processed: 1000, historyId: '9999', durationMs: 412 };
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@feature §4.6 §7.3 email-sync-gmail edge function handler', () => {
  test('§7.3 returns 202 with backfill result on successful run', async () => {
    const { status, body } = await handleEdgeBackfill(VALID_AUTH_HEADER, makeDeps());
    expect(status).toBe(202);
    expect(body.ok).toBe(true);
    const result = body.result as BackfillResult;
    expect(result.processed).toBe(1000);
    expect(result.historyId).toBe('9999');
    expect(typeof result.durationMs).toBe('number');
  });

  test('§4.6 returns 401 when Authorization header is absent', async () => {
    const { status, body } = await handleEdgeBackfill(null, makeDeps());
    expect(status).toBe(401);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/unauthenticated/i);
  });

  test('§4.6 returns 401 when JWT is invalid or expired', async () => {
    const { status, body } = await handleEdgeBackfill('Bearer invalid-jwt', makeDeps());
    expect(status).toBe(401);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/unauthenticated/i);
  });

  test('§4.6 returns 401 when Authorization header has wrong scheme', async () => {
    const { status, body } = await handleEdgeBackfill('Basic dXNlcjpwYXNz', makeDeps({
      async verifyAuth() { return null; },
    }));
    expect(status).toBe(401);
    expect(body.ok).toBe(false);
  });

  test('§7.3 returns 400 when user has no Gmail OAuth token', async () => {
    const { status, body } = await handleEdgeBackfill(
      VALID_AUTH_HEADER,
      makeDeps({ async loadRefreshToken() { return null; } }),
    );
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/no Gmail oauth token/);
  });

  test('§7.3 returns 500 when token lookup throws (storage error)', async () => {
    const { status, body } = await handleEdgeBackfill(
      VALID_AUTH_HEADER,
      makeDeps({
        async loadRefreshToken() {
          throw new Error('connection timeout');
        },
      }),
    );
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/connection timeout/);
  });

  test('§7.3 returns 500 when backfill throws (e.g. Gmail quota exceeded)', async () => {
    const { status, body } = await handleEdgeBackfill(
      VALID_AUTH_HEADER,
      makeDeps({
        async runBackfill() {
          throw new Error('Gmail API quota exceeded');
        },
      }),
    );
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/Gmail API quota exceeded/);
  });

  test('§7.3 passes correct userId and refreshToken to runBackfill', async () => {
    const calls: Array<{ userId: string; refreshToken: string }> = [];

    await handleEdgeBackfill(
      VALID_AUTH_HEADER,
      makeDeps({
        async runBackfill(userId, refreshToken) {
          calls.push({ userId, refreshToken });
          return { processed: 5, historyId: '1234', durationMs: 50 };
        },
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBe(FIXTURE_USER_ID);
    expect(calls[0].refreshToken).toBe(FIXTURE_REFRESH_TOKEN);
  });

  test('§7.3 body.result exposes processed count and historyId', async () => {
    const { body } = await handleEdgeBackfill(
      VALID_AUTH_HEADER,
      makeDeps({
        async runBackfill() {
          return { processed: 847, historyId: '5000', durationMs: 1200 };
        },
      }),
    );
    const result = body.result as BackfillResult;
    expect(result.processed).toBe(847);
    expect(result.historyId).toBe('5000');
  });

  test('§7.3 body.result.historyId may be null (empty mailbox)', async () => {
    const { status, body } = await handleEdgeBackfill(
      VALID_AUTH_HEADER,
      makeDeps({
        async runBackfill() {
          return { processed: 0, historyId: null, durationMs: 10 };
        },
      }),
    );
    expect(status).toBe(202);
    const result = body.result as BackfillResult;
    expect(result.historyId).toBeNull();
    expect(result.processed).toBe(0);
  });
});
