/**
 * AINBOX-5: Gmail backfill + delta sync — feature spec.
 *
 * PRD anchors: §3.8, §4.2, §4.3, §7.3, §7.5, §7.17, §7.18.
 *
 * Strategy:
 *   The Gmail worker (`src/lib/sync/gmail.ts`) accepts an injectable `deps.gmail` client,
 *   so we mock at the module's network boundary by passing a fake `GmailLikeClient`. This
 *   is equivalent to vi.mock at the import boundary but works inside Playwright's
 *   Node-driven test runner without adding vitest/msw as a dep.
 *
 *   Fixture addresses use the synthesised `@ainbox.test` TLD per factory-rules.md hard
 *   rule #8 / PRD §4.3 — never real email content.
 */

import { test, expect } from '@playwright/test';
import {
  runGmailBackfill,
  runGmailIncremental,
  isRetryable,
  backoffMs,
  extractBody,
  QuotaPacer,
  BACKFILL_TARGET,
  type GmailLikeClient,
  type ProgressEmitter,
  type SyncStorage,
  type PersistedMessageRow,
  type SyncProgressPayload,
} from '../../src/lib/sync/gmail';
import { decryptForUser, isCiphertext } from '../../src/lib/crypto';

// Master key required for crypto. Stable, base64, 32 bytes — fixture only.
process.env.AINBOX_ENC_MASTER_KEY ??= Buffer.alloc(32, 7).toString('base64');

// --- helpers ---------------------------------------------------------------

interface FakeMessage {
  id: string;
  threadId: string;
  historyId: string;
  internalDate: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  labels: string[];
}

function synthMessage(i: number): FakeMessage {
  return {
    id: `m-${i}`,
    threadId: `t-${Math.floor(i / 5)}`,
    historyId: String(1000 + i),
    internalDate: String(1_700_000_000_000 + i * 60_000),
    from: `sender-${i}@ainbox.test`,
    to: `recipient@ainbox.test`,
    subject: `Synth subject ${i}`,
    body: `Synth body ${i} — non-PII fixture content for test pass.`,
    labels: i % 2 === 0 ? ['INBOX'] : ['SENT'],
  };
}

function gmailMessageOf(m: FakeMessage) {
  return {
    id: m.id,
    threadId: m.threadId,
    historyId: m.historyId,
    internalDate: m.internalDate,
    sizeEstimate: m.body.length,
    labelIds: m.labels,
    payload: {
      headers: [
        { name: 'From', value: m.from },
        { name: 'To', value: m.to },
        { name: 'Subject', value: m.subject },
      ],
      body: { data: Buffer.from(m.body, 'utf8').toString('base64url') },
    },
  };
}

interface FakeGmailOptions {
  messages: FakeMessage[];
  pageSize?: number;
  /** Sequence of synthetic failures: index N fails on attempt 1..N[i] times before succeeding. */
  failGetTimes?: Map<string, number>;
  /** Force `messages.list` to fail this many times before first success. */
  failListTimes?: number;
}

function makeFakeGmail(opts: FakeGmailOptions): { client: GmailLikeClient; calls: { list: number; get: number; history: number } } {
  const calls = { list: 0, get: 0, history: 0 };
  const pageSize = opts.pageSize ?? 100;
  const failGet = new Map(opts.failGetTimes ?? []);
  let listFailsLeft = opts.failListTimes ?? 0;

  const client: GmailLikeClient = {
    users: {
      messages: {
        async list(params) {
          calls.list++;
          if (listFailsLeft > 0) {
            listFailsLeft--;
            const e = new Error('synthetic 503') as Error & { code: number };
            e.code = 503;
            throw e;
          }
          const offset = params.pageToken ? Number(params.pageToken) : 0;
          const max = Math.min(params.maxResults ?? pageSize, pageSize);
          const slice = opts.messages.slice(offset, offset + max);
          const next = offset + max < opts.messages.length ? String(offset + max) : null;
          return {
            data: {
              messages: slice.map((m) => ({ id: m.id, threadId: m.threadId })),
              nextPageToken: next ?? undefined,
              resultSizeEstimate: opts.messages.length,
            },
          };
        },
        async get(params) {
          calls.get++;
          const id = params.id!;
          const fails = failGet.get(id) ?? 0;
          if (fails > 0) {
            failGet.set(id, fails - 1);
            const e = new Error('synthetic 429') as Error & { code: number };
            e.code = 429;
            throw e;
          }
          const m = opts.messages.find((x) => x.id === id);
          if (!m) throw new Error(`unknown id ${id}`);
          return { data: gmailMessageOf(m) };
        },
      },
      history: {
        async list(params) {
          calls.history++;
          // For delta tests we treat all messages as new since startHistoryId.
          const start = Number(params.startHistoryId);
          const newer = opts.messages.filter((m) => Number(m.historyId) > start);
          return {
            data: {
              history: newer.map((m) => ({
                id: m.historyId,
                messages: [{ id: m.id, threadId: m.threadId }],
                messagesAdded: [{ message: { id: m.id, threadId: m.threadId } }],
              })),
              historyId: newer.length > 0 ? newer[newer.length - 1].historyId : params.startHistoryId,
              nextPageToken: undefined,
            },
          };
        },
      },
    },
  };
  return { client, calls };
}

function makeFakeStorage(): { storage: SyncStorage; rows: PersistedMessageRow[]; state: Map<string, { historyId: string | null }> } {
  const rows: PersistedMessageRow[] = [];
  const state = new Map<string, { historyId: string | null }>();
  return {
    rows,
    state,
    storage: {
      async persistMessage(row) {
        // idempotency on (user_id, gmail_id)
        const idx = rows.findIndex((r) => r.user_id === row.user_id && r.gmail_id === row.gmail_id);
        if (idx >= 0) rows[idx] = row;
        else rows.push(row);
      },
      async updateSyncState(userId, s) {
        const cur = state.get(userId) ?? { historyId: null };
        if (s.historyId !== undefined) cur.historyId = s.historyId;
        state.set(userId, cur);
      },
      async getSyncState(userId) {
        return state.get(userId) ?? null;
      },
    },
  };
}

function makeFakeProgress(): { progress: ProgressEmitter; events: Array<{ userId: string; payload: SyncProgressPayload }> } {
  const events: Array<{ userId: string; payload: SyncProgressPayload }> = [];
  return {
    events,
    progress: {
      async emit(userId, payload) {
        events.push({ userId, payload });
      },
    },
  };
}

const noopSleep = async () => {
  /* skip real waiting in tests */
};

// --- tests -----------------------------------------------------------------

test.describe('@feature §7.3 §7.5 §7.17 §7.18 Gmail sync worker', () => {
  test('§7.3 1000-message backfill completes and emits per-batch progress', async () => {
    const userId = 'user-fixture-001';
    const messages = Array.from({ length: 1500 }, (_, i) => synthMessage(i));
    const { client, calls } = makeFakeGmail({ messages, pageSize: 100 });
    const { storage, rows, state } = makeFakeStorage();
    const { progress, events } = makeFakeProgress();

    const result = await runGmailBackfill(userId, { gmail: client, storage, progress, sleep: noopSleep });

    expect(result.processed).toBe(BACKFILL_TARGET);
    expect(rows.length).toBe(BACKFILL_TARGET);
    // We never pull more than the target even if the mailbox has 1500.
    expect(calls.get).toBe(BACKFILL_TARGET);
    // 10 batches of 100 => 10 list calls, plus 1 short-circuit possible.
    expect(calls.list).toBeGreaterThanOrEqual(10);
    // Per-batch progress events: at least 10 (one per batch) plus a final done event.
    const doneEvents = events.filter((e) => e.payload.done);
    const progressEvents = events.filter((e) => !e.payload.done);
    expect(progressEvents.length).toBeGreaterThanOrEqual(10);
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].payload.processed).toBe(BACKFILL_TARGET);
    // History id is advanced.
    expect(state.get(userId)?.historyId).not.toBeNull();
  });

  test('§4.3 body is encrypted before write (no plaintext on disk)', async () => {
    const userId = 'user-fixture-002';
    const messages = Array.from({ length: 5 }, (_, i) => synthMessage(i));
    const { client } = makeFakeGmail({ messages, pageSize: 5 });
    const { storage, rows } = makeFakeStorage();
    const { progress } = makeFakeProgress();

    await runGmailBackfill(userId, { gmail: client, storage, progress, sleep: noopSleep });

    // Truncate to first 5 since BACKFILL_TARGET=1000 — but we only had 5 in mailbox,
    // so backfill stops when nextPageToken disappears.
    expect(rows.length).toBe(5);
    for (const r of rows) {
      // Never store plaintext.
      expect(r.body_encrypted.includes('Synth body')).toBe(false);
      expect(isCiphertext(r.body_encrypted)).toBe(true);
      // Round-trip decryption recovers the plaintext.
      const decoded = decryptForUser(userId, r.body_encrypted);
      expect(decoded).toContain('Synth body');
    }
    // A different user_id cannot decrypt — tenant isolation.
    expect(() => decryptForUser('other-user', rows[0].body_encrypted)).toThrow();
  });

  test('§7.17 §7.18 rate-limit handling triggers exponential backoff (429 + 503)', async () => {
    const userId = 'user-fixture-003';
    const messages = Array.from({ length: 3 }, (_, i) => synthMessage(i));
    // m-0 fails twice with 429, m-1 once, m-2 zero times.
    const failGetTimes = new Map([
      ['m-0', 2],
      ['m-1', 1],
    ]);
    const { client, calls } = makeFakeGmail({
      messages,
      pageSize: 3,
      failGetTimes,
      failListTimes: 1,
    });
    const { storage, rows } = makeFakeStorage();
    const { progress } = makeFakeProgress();

    const sleeps: number[] = [];
    const recordingSleep = async (ms: number) => {
      sleeps.push(ms);
    };

    const result = await runGmailBackfill(userId, {
      gmail: client,
      storage,
      progress,
      sleep: recordingSleep,
    });

    // All 3 messages eventually persisted.
    expect(result.processed).toBe(3);
    expect(rows.length).toBe(3);
    // Backoff triggered: at minimum 1 (list) + 2 (m-0) + 1 (m-1) = 4 retry sleeps.
    // (Pacer also calls sleep when pacing, but with our fake clock that should be 0;
    // the recorded sleeps include both — assert at least the retry count.)
    const backoffSleeps = sleeps.filter((ms) => ms >= 1000);
    expect(backoffSleeps.length).toBeGreaterThanOrEqual(4);
    // Backoff sequence is exponential: 1000, 2000, 4000, ...
    expect(backoffSleeps).toContain(1000);
    expect(backoffSleeps).toContain(2000);
    // Total list+get calls reflect retries.
    expect(calls.list).toBeGreaterThanOrEqual(2); // 1 fail + 1 success
    expect(calls.get).toBeGreaterThanOrEqual(3 + 2 + 1); // base + retries
  });

  test('§7.5 incremental delta sync uses historyId from sync state', async () => {
    const userId = 'user-fixture-004';
    const messages = Array.from({ length: 4 }, (_, i) => synthMessage(i));
    // Pre-seed state at historyId=1001 — so messages with historyId>1001 are "new".
    const { storage, rows, state } = makeFakeStorage();
    state.set(userId, { historyId: '1001' });
    const { client } = makeFakeGmail({ messages });
    const { progress } = makeFakeProgress();

    const result = await runGmailIncremental(userId, {
      gmail: client,
      storage,
      progress,
      sleep: noopSleep,
    });

    // Messages 2 and 3 (historyId 1002, 1003) are newer than 1001.
    expect(result.newOrChanged).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // History id advances past the seed.
    expect(state.get(userId)?.historyId).not.toBe('1001');
  });

  test('§7.5 incremental refuses to run without prior backfill state', async () => {
    const userId = 'user-fixture-005';
    const { client } = makeFakeGmail({ messages: [] });
    const { storage } = makeFakeStorage();
    const { progress } = makeFakeProgress();

    await expect(
      runGmailIncremental(userId, { gmail: client, storage, progress, sleep: noopSleep }),
    ).rejects.toThrow(/no historyId/);
  });

  test('isRetryable + backoffMs unit checks', () => {
    expect(isRetryable({ code: 429 })).toBe(true);
    expect(isRetryable({ code: 503 })).toBe(true);
    expect(isRetryable({ code: 400 })).toBe(false);
    expect(isRetryable({ code: 401 })).toBe(false);
    expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryable(null)).toBe(false);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(6)).toBe(32_000);
  });

  test('extractBody decodes nested multipart', () => {
    const msg = {
      payload: {
        parts: [
          { body: { data: Buffer.from('hello ', 'utf8').toString('base64url') } },
          {
            parts: [{ body: { data: Buffer.from('world', 'utf8').toString('base64url') } }],
          },
        ],
      },
    };
    expect(extractBody(msg)).toContain('hello ');
    expect(extractBody(msg)).toContain('world');
  });

  test('QuotaPacer holds the worker under the 250 quota/sec ceiling', async () => {
    let virtual = 0;
    const sleep = async (ms: number) => {
      virtual += ms;
    };
    const now = () => virtual;
    const pacer = new QuotaPacer(sleep, now);
    // Consume 5x the per-second budget = 1250 units. Should require ~4 seconds of waits.
    const totalUnits = 250 * 5;
    for (let i = 0; i < totalUnits; i++) {
      await pacer.consume(1);
    }
    // After draining initial bucket (250) we needed ~1000 more units => ~4000ms.
    expect(virtual).toBeGreaterThanOrEqual(3500);
  });
});
