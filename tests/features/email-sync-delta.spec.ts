/**
 * AINBOX-30: §7.5 Email sync — incremental delta cron orchestration tests.
 *
 * PRD anchors: §7.5 (delta sync), §4.1 (tenant isolation), §4.3 (content handling).
 *
 * Tests the pure orchestration functions in src/lib/sync/delta-cron.ts.
 * All dependencies are injected as mocks — no real Gmail/Graph API or Supabase calls.
 * Fixture addresses use the @ainbox.test / .invalid TLDs per factory-rules §8.
 */

import { test, expect } from '@playwright/test';
import {
  runGmailDeltaCron,
  runOutlookDeltaCron,
  type GmailDeltaCronDeps,
  type OutlookDeltaCronDeps,
  type UserTokenRow,
  type DeltaCronUserResult,
} from '../../src/lib/sync/delta-cron';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(i: number): UserTokenRow {
  return {
    userId: `user-delta-${i}`,
    refreshToken: `refresh-${i}-fixture`,
  };
}

function makeGmailDeps(opts: {
  users: UserTokenRow[];
  syncImpl?: (userId: string, refreshToken: string) => Promise<{ newOrChanged: number; newHistoryId: string | null }>;
}): GmailDeltaCronDeps & { callLog: Array<{ userId: string; refreshToken: string }> } {
  const callLog: Array<{ userId: string; refreshToken: string }> = [];
  return {
    callLog,
    listUsers: async () => opts.users,
    syncUser:
      opts.syncImpl ??
      (async (userId, refreshToken) => {
        callLog.push({ userId, refreshToken });
        return { newOrChanged: 3, newHistoryId: '9999' };
      }),
  };
}

function makeOutlookDeps(opts: {
  users: UserTokenRow[];
  syncImpl?: (userId: string, refreshToken: string) => Promise<{ persisted: number; deltaToken: string | null }>;
}): OutlookDeltaCronDeps & { callLog: Array<{ userId: string; refreshToken: string }> } {
  const callLog: Array<{ userId: string; refreshToken: string }> = [];
  return {
    callLog,
    listUsers: async () => opts.users,
    syncUser:
      opts.syncImpl ??
      (async (userId, refreshToken) => {
        callLog.push({ userId, refreshToken });
        return { persisted: 2, deltaToken: 'https://graph.microsoft.com/delta?token=NEW' };
      }),
  };
}

// ---------------------------------------------------------------------------
// Gmail delta cron tests
// ---------------------------------------------------------------------------

test.describe('@feature §7.5 Gmail delta cron orchestration', () => {
  test('iterates all users and returns per-user results', async () => {
    const users = [makeUser(1), makeUser(2), makeUser(3)];
    const deps = makeGmailDeps({ users });

    const summary = await runGmailDeltaCron(deps);

    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.results).toHaveLength(3);

    for (const r of summary.results) {
      expect(r.ok).toBe(true);
      expect(r.synced).toBe(3);
    }
  });

  test('passes the correct refreshToken to syncUser for each user', async () => {
    const users = [makeUser(10), makeUser(11)];
    const deps = makeGmailDeps({ users });

    await runGmailDeltaCron(deps);

    expect(deps.callLog).toHaveLength(2);
    expect(deps.callLog[0]).toEqual({ userId: 'user-delta-10', refreshToken: 'refresh-10-fixture' });
    expect(deps.callLog[1]).toEqual({ userId: 'user-delta-11', refreshToken: 'refresh-11-fixture' });
  });

  test('skips users who have no historyId (backfill not yet complete)', async () => {
    const users = [makeUser(20), makeUser(21), makeUser(22)];
    const deps = makeGmailDeps({
      users,
      syncImpl: async (userId) => {
        if (userId === 'user-delta-21') {
          throw new Error('runGmailIncremental: no historyId — run backfill first (§7.3)');
        }
        return { newOrChanged: 1, newHistoryId: '8000' };
      },
    });

    const summary = await runGmailDeltaCron(deps);

    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(1);

    const skipResult = summary.results.find((r) => r.userId === 'user-delta-21');
    expect(skipResult?.ok).toBe(false);
    expect(skipResult?.skipped).toBe(true);
    expect(skipResult?.errorMessage).toMatch(/no historyId/);
  });

  test('records failures for other error types without skipped=true', async () => {
    const users = [makeUser(30)];
    const deps = makeGmailDeps({
      users,
      syncImpl: async () => {
        throw new Error('Gmail API 503 Service Unavailable');
      },
    });

    const summary = await runGmailDeltaCron(deps);

    expect(summary.total).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.results[0].ok).toBe(false);
    expect(summary.results[0].skipped).toBe(false);
    expect(summary.results[0].errorMessage).toContain('503');
  });

  test('one user failure does not block other users', async () => {
    const users = [makeUser(40), makeUser(41), makeUser(42)];
    const deps = makeGmailDeps({
      users,
      syncImpl: async (userId) => {
        if (userId === 'user-delta-40') {
          throw new Error('token expired');
        }
        return { newOrChanged: 5, newHistoryId: '7000' };
      },
    });

    const summary = await runGmailDeltaCron(deps);

    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.results.find((r) => r.userId === 'user-delta-41')?.ok).toBe(true);
    expect(summary.results.find((r) => r.userId === 'user-delta-42')?.ok).toBe(true);
  });

  test('onResult callback is called for each user', async () => {
    const users = [makeUser(50), makeUser(51)];
    const events: DeltaCronUserResult[] = [];
    const deps: GmailDeltaCronDeps = {
      listUsers: async () => users,
      syncUser: async () => ({ newOrChanged: 1, newHistoryId: 'x' }),
      onResult: (r) => events.push(r),
    };

    await runGmailDeltaCron(deps);

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.ok)).toBe(true);
  });

  test('empty user list returns zero summary', async () => {
    const deps = makeGmailDeps({ users: [] });
    const summary = await runGmailDeltaCron(deps);

    expect(summary.total).toBe(0);
    expect(summary.results).toHaveLength(0);
    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Outlook delta cron tests
// ---------------------------------------------------------------------------

test.describe('@feature §7.5 Outlook delta cron orchestration', () => {
  test('iterates all Outlook users and returns per-user results', async () => {
    const users = [makeUser(100), makeUser(101)];
    const deps = makeOutlookDeps({ users });

    const summary = await runOutlookDeltaCron(deps);

    expect(summary.total).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.results).toHaveLength(2);
    for (const r of summary.results) {
      expect(r.ok).toBe(true);
      expect(r.synced).toBe(2);
    }
  });

  test('passes the correct refreshToken to Outlook syncUser', async () => {
    const users = [makeUser(110)];
    const deps = makeOutlookDeps({ users });

    await runOutlookDeltaCron(deps);

    expect(deps.callLog[0]).toEqual({ userId: 'user-delta-110', refreshToken: 'refresh-110-fixture' });
  });

  test('Outlook: one failure does not block other users', async () => {
    const users = [makeUser(120), makeUser(121)];
    const deps = makeOutlookDeps({
      users,
      syncImpl: async (userId) => {
        if (userId === 'user-delta-120') throw new Error('MS Graph 429');
        return { persisted: 4, deltaToken: 'delta-tok' };
      },
    });

    const summary = await runOutlookDeltaCron(deps);

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results.find((r) => r.userId === 'user-delta-121')?.ok).toBe(true);
  });

  test('Outlook: failed user captures error message', async () => {
    const users = [makeUser(130)];
    const deps = makeOutlookDeps({
      users,
      syncImpl: async () => { throw new Error('token_refresh_failed'); },
    });

    const summary = await runOutlookDeltaCron(deps);

    expect(summary.results[0].ok).toBe(false);
    expect(summary.results[0].errorMessage).toContain('token_refresh_failed');
  });

  test('Outlook: empty user list returns zero summary', async () => {
    const deps = makeOutlookDeps({ users: [] });
    const summary = await runOutlookDeltaCron(deps);
    expect(summary.total).toBe(0);
    expect(summary.results).toHaveLength(0);
  });
});
