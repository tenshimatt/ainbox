/**
 * AINBOX-30: Incremental delta sync orchestrator — feature spec.
 *
 * PRD §7.5 — fan-out incremental sync across all connected accounts.
 *
 * Tests the runDeltaSync orchestrator (src/lib/sync/delta-cron.ts) with
 * injectable deps so we never hit real Gmail, Graph, or Supabase.
 */

import { test, expect } from '@playwright/test';
import {
  runDeltaSync,
  type DeltaCronDeps,
  type DeltaSyncTarget,
} from '../../src/lib/sync/delta-cron';

function makeDeps(overrides: Partial<DeltaCronDeps> = {}): DeltaCronDeps {
  return {
    listSyncTargets: async () => [],
    syncGmailUser: async () => ({ newOrChanged: 0 }),
    syncOutlookUser: async () => ({ persisted: 0 }),
    ...overrides,
  };
}

test.describe('@feature §7.5 incremental delta sync orchestrator', () => {
  test('empty target list returns zero counts', async () => {
    const result = await runDeltaSync(makeDeps({ listSyncTargets: async () => [] }));
    expect(result.total).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test('syncs all targets and counts successes', async () => {
    const targets: DeltaSyncTarget[] = [
      { userId: 'u1', provider: 'gmail' },
      { userId: 'u2', provider: 'outlook' },
      { userId: 'u3', provider: 'gmail' },
    ];
    const synced: string[] = [];

    const result = await runDeltaSync(
      makeDeps({
        listSyncTargets: async () => targets,
        syncGmailUser: async (userId) => {
          synced.push(`gmail:${userId}`);
          return { newOrChanged: 1 };
        },
        syncOutlookUser: async (userId) => {
          synced.push(`outlook:${userId}`);
          return { persisted: 2 };
        },
      }),
    );

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(synced).toContain('gmail:u1');
    expect(synced).toContain('outlook:u2');
    expect(synced).toContain('gmail:u3');
  });

  test('isolates per-user errors — one failure does not stop others', async () => {
    const targets: DeltaSyncTarget[] = [
      { userId: 'u1', provider: 'gmail' },
      { userId: 'u2', provider: 'gmail' },
      { userId: 'u3', provider: 'gmail' },
    ];
    const synced: string[] = [];

    const result = await runDeltaSync(
      makeDeps({
        listSyncTargets: async () => targets,
        syncGmailUser: async (userId) => {
          if (userId === 'u2') throw new Error('gmail API error');
          synced.push(userId);
          return { newOrChanged: 5 };
        },
      }),
    );

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(synced).toContain('u1');
    expect(synced).toContain('u3');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      userId: 'u2',
      provider: 'gmail',
      error: 'gmail API error',
    });
  });

  test('§7.5 "no historyId" is counted as skipped, not failed', async () => {
    const targets: DeltaSyncTarget[] = [
      { userId: 'u1', provider: 'gmail' },
      { userId: 'u2', provider: 'gmail' },
    ];

    const result = await runDeltaSync(
      makeDeps({
        listSyncTargets: async () => targets,
        syncGmailUser: async (userId) => {
          if (userId === 'u1') {
            throw new Error(
              'runGmailIncremental: no historyId — run backfill first (§7.3)',
            );
          }
          return { newOrChanged: 3 };
        },
      }),
    );

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].userId).toBe('u1');
  });

  test('§7.5 "no delta token" is counted as skipped for outlook', async () => {
    const targets: DeltaSyncTarget[] = [{ userId: 'u1', provider: 'outlook' }];

    const result = await runDeltaSync(
      makeDeps({
        listSyncTargets: async () => targets,
        syncOutlookUser: async () => {
          throw new Error('no delta token — run backfill first');
        },
      }),
    );

    expect(result.total).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  test('multiple failures accumulate in errors array', async () => {
    const targets: DeltaSyncTarget[] = [
      { userId: 'u1', provider: 'gmail' },
      { userId: 'u2', provider: 'outlook' },
    ];

    const result = await runDeltaSync(
      makeDeps({
        listSyncTargets: async () => targets,
        syncGmailUser: async () => {
          throw new Error('quota exceeded');
        },
        syncOutlookUser: async () => {
          throw new Error('invalid token');
        },
      }),
    );

    expect(result.total).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.succeeded).toBe(0);
    expect(result.errors).toHaveLength(2);
    const msgs = result.errors.map((e) => e.error);
    expect(msgs).toContain('quota exceeded');
    expect(msgs).toContain('invalid token');
  });

  test('listSyncTargets failure propagates as thrown error', async () => {
    await expect(
      runDeltaSync(
        makeDeps({
          listSyncTargets: async () => {
            throw new Error('db connection lost');
          },
        }),
      ),
    ).rejects.toThrow('db connection lost');
  });

  test('routes gmail and outlook targets to correct sync functions', async () => {
    const gmailCalls: string[] = [];
    const outlookCalls: string[] = [];
    const targets: DeltaSyncTarget[] = [
      { userId: 'gUser', provider: 'gmail' },
      { userId: 'oUser', provider: 'outlook' },
    ];

    await runDeltaSync(
      makeDeps({
        listSyncTargets: async () => targets,
        syncGmailUser: async (userId) => {
          gmailCalls.push(userId);
          return { newOrChanged: 0 };
        },
        syncOutlookUser: async (userId) => {
          outlookCalls.push(userId);
          return { persisted: 0 };
        },
      }),
    );

    expect(gmailCalls).toEqual(['gUser']);
    expect(outlookCalls).toEqual(['oUser']);
  });
});
