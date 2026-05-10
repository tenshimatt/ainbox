/**
 * AINBOX-19: email-sync-gmail edge-function handler — feature spec.
 *
 * PRD anchors: §3.8, §4.2, §4.3, §7.3, §7.5.
 *
 * Strategy:
 *   Tests target the Node-compatible handler module (`src/lib/sync/gmail-edge-handler.ts`)
 *   using the same mock-injection pattern as the gmail-sync.spec.ts worker tests.
 *   No real Supabase instance, no real Gmail API, no network access.
 *
 *   Coverage:
 *     - Mode selection: backfill when no historyId, incremental when historyId exists.
 *     - `SupabaseSyncStorage` read/write contract via a typed Supabase mock.
 *     - `handleGmailSync` result shape and delegation to the worker.
 *     - Error path: missing refresh token.
 *
 *   Fixture addresses use `@ainbox.test` TLD per factory-rules.md hard rule #8.
 */

import { test, expect } from '@playwright/test';
import {
  handleGmailSync,
  SupabaseSyncStorage,
  NoopProgressEmitter,
  type GmailEdgeResult,
} from '../../src/lib/sync/gmail-edge-handler';
import type {
  GmailLikeClient,
  ProgressEmitter,
  SyncStorage,
  PersistedMessageRow,
  SyncProgressPayload,
} from '../../src/lib/sync/gmail';

// Stable fixture master key — never real, 32 bytes.
process.env.AINBOX_ENC_MASTER_KEY ??= Buffer.alloc(32, 0x42).toString('base64');

// ---------------------------------------------------------------------------
// Helpers: minimal GmailLikeClient mock
// ---------------------------------------------------------------------------

function synthMessage(i: number) {
  return {
    id: `em-${i}`,
    threadId: `et-${Math.floor(i / 5)}`,
    historyId: String(2000 + i),
    internalDate: String(1_700_000_000_000 + i * 60_000),
    sizeEstimate: 100 + i,
    labelIds: i % 3 === 0 ? ['SENT'] : ['INBOX'],
    payload: {
      headers: [
        { name: 'From', value: `from-${i}@ainbox.test` },
        { name: 'To', value: 'inbox@ainbox.test' },
        { name: 'Subject', value: `Edge synth subject ${i}` },
      ],
      body: { data: Buffer.from(`Edge synth body ${i}`, 'utf8').toString('base64url') },
    },
  };
}

function makeMockGmailClient(messages: ReturnType<typeof synthMessage>[]): GmailLikeClient {
  return {
    users: {
      messages: {
        async list(params) {
          const offset = params.pageToken ? Number(params.pageToken) : 0;
          const max = params.maxResults ?? 100;
          const slice = messages.slice(offset, offset + max);
          const next = offset + max < messages.length ? String(offset + max) : null;
          return {
            data: {
              messages: slice.map((m) => ({ id: m.id, threadId: m.threadId })),
              nextPageToken: next ?? undefined,
              resultSizeEstimate: messages.length,
            },
          };
        },
        async get(params) {
          const m = messages.find((x) => x.id === params.id);
          if (!m) throw new Error(`mock: unknown id ${params.id}`);
          return { data: m };
        },
      },
      history: {
        async list(params) {
          const start = Number(params.startHistoryId);
          const newer = messages.filter((m) => Number(m.historyId) > start);
          return {
            data: {
              history: newer.map((m) => ({
                id: m.historyId,
                messages: [{ id: m.id }],
                messagesAdded: [{ message: { id: m.id } }],
              })),
              historyId: newer.length ? newer[newer.length - 1].historyId : params.startHistoryId,
              nextPageToken: undefined,
            },
          };
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers: in-memory SyncStorage + ProgressEmitter
// ---------------------------------------------------------------------------

function makeMemoryStorage(): {
  storage: SyncStorage;
  rows: PersistedMessageRow[];
  states: Map<string, { historyId: string | null }>;
} {
  const rows: PersistedMessageRow[] = [];
  const states = new Map<string, { historyId: string | null }>();
  return {
    rows,
    states,
    storage: {
      async persistMessage(row) {
        const idx = rows.findIndex((r) => r.user_id === row.user_id && r.gmail_id === row.gmail_id);
        if (idx >= 0) rows[idx] = row;
        else rows.push(row);
      },
      async updateSyncState(userId, s) {
        const cur = states.get(userId) ?? { historyId: null };
        if (s.historyId !== undefined) cur.historyId = s.historyId;
        states.set(userId, cur);
      },
      async getSyncState(userId) {
        return states.get(userId) ?? null;
      },
    },
  };
}

function makeMemoryProgress(): { progress: ProgressEmitter; events: SyncProgressPayload[] } {
  const events: SyncProgressPayload[] = [];
  return {
    events,
    progress: { async emit(_uid, payload) { events.push(payload); } },
  };
}

const noopSleep = async () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-19 email-sync-gmail edge handler', () => {

  test('§7.3 backfill mode selected when no prior sync state', async () => {
    const userId = 'edge-user-001';
    const messages = Array.from({ length: 5 }, (_, i) => synthMessage(i));
    const { storage } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    const result: GmailEdgeResult = await handleGmailSync({
      userId,
      getRefreshToken: async () => 'fake-refresh-token',
      buildGmailClient: async () => makeMockGmailClient(messages),
      storage,
      progress,
      sleep: noopSleep,
    });

    expect(result.mode).toBe('backfill');
    expect(result.userId).toBe(userId);
    expect(result.processed).toBe(5);
    expect(result.historyId).not.toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('§7.5 incremental mode selected when historyId exists in sync state', async () => {
    const userId = 'edge-user-002';
    const messages = Array.from({ length: 6 }, (_, i) => synthMessage(i));
    const { storage, states } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    // Pre-seed a historyId so incremental is chosen.
    states.set(userId, { historyId: '2002' });

    const result: GmailEdgeResult = await handleGmailSync({
      userId,
      getRefreshToken: async () => 'fake-refresh-token',
      buildGmailClient: async () => makeMockGmailClient(messages),
      storage,
      progress,
      sleep: noopSleep,
    });

    expect(result.mode).toBe('incremental');
    // historyId 2003, 2004, 2005 are > 2002 → 3 messages.
    expect(result.processed).toBeGreaterThanOrEqual(3);
  });

  test('§7.3 backfill persists messages with encrypted bodies', async () => {
    const { decryptForUser, isCiphertext } = await import('../../src/lib/crypto');
    const userId = 'edge-user-003';
    const messages = Array.from({ length: 3 }, (_, i) => synthMessage(i));
    const { storage, rows } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    await handleGmailSync({
      userId,
      getRefreshToken: async () => 'fake-refresh-token',
      buildGmailClient: async () => makeMockGmailClient(messages),
      storage,
      progress,
      sleep: noopSleep,
    });

    expect(rows.length).toBe(3);
    for (const row of rows) {
      // Body must be encrypted — never plaintext on disk (§4.3).
      expect(row.body_encrypted.includes('Edge synth body')).toBe(false);
      expect(isCiphertext(row.body_encrypted)).toBe(true);
      // Round-trip decryption must recover the plaintext.
      const decoded = decryptForUser(userId, row.body_encrypted);
      expect(decoded).toContain('Edge synth body');
      // Subject hash must be present.
      expect(row.subject_hash).not.toBeNull();
      expect(row.user_id).toBe(userId);
    }
  });

  test('§4.3 different user cannot decrypt persisted body (tenant isolation)', async () => {
    const { decryptForUser } = await import('../../src/lib/crypto');
    const userId = 'edge-user-004';
    const messages = [synthMessage(0)];
    const { storage, rows } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    await handleGmailSync({
      userId,
      getRefreshToken: async () => 'fake-refresh-token',
      buildGmailClient: async () => makeMockGmailClient(messages),
      storage,
      progress,
      sleep: noopSleep,
    });

    expect(rows.length).toBe(1);
    expect(() => decryptForUser('other-tenant', rows[0].body_encrypted)).toThrow();
  });

  test('§4.2 error propagated when getRefreshToken throws', async () => {
    const userId = 'edge-user-005';
    const { storage } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    await expect(
      handleGmailSync({
        userId,
        getRefreshToken: async () => { throw new Error('Gmail not connected'); },
        buildGmailClient: async () => makeMockGmailClient([]),
        storage,
        progress,
        sleep: noopSleep,
      }),
    ).rejects.toThrow('Gmail not connected');
  });

  test('result has correct shape for backfill of 0 messages', async () => {
    const userId = 'edge-user-006';
    const { storage } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    const result = await handleGmailSync({
      userId,
      getRefreshToken: async () => 'fake-refresh-token',
      buildGmailClient: async () => makeMockGmailClient([]),
      storage,
      progress,
      sleep: noopSleep,
    });

    expect(result.mode).toBe('backfill');
    expect(result.userId).toBe(userId);
    expect(result.processed).toBe(0);
    // historyId stays null when mailbox is empty.
    expect(result.historyId).toBeNull();
  });

  test('SupabaseSyncStorage getSyncState returns null when no row exists', async () => {
    const userId = 'edge-user-007';
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ss = new SupabaseSyncStorage(mockSupabase as any, userId);
    const state = await ss.getSyncState(userId);
    expect(state).toBeNull();
  });

  test('SupabaseSyncStorage getSyncState returns historyId when row exists', async () => {
    const userId = 'edge-user-008';
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { history_id: '9999' }, error: null }),
            }),
          }),
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ss = new SupabaseSyncStorage(mockSupabase as any, userId);
    const state = await ss.getSyncState(userId);
    expect(state).toEqual({ historyId: '9999' });
  });

  test('SupabaseSyncStorage getSyncState throws on Supabase error', async () => {
    const userId = 'edge-user-009';
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: 'db error' } }),
            }),
          }),
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ss = new SupabaseSyncStorage(mockSupabase as any, userId);
    await expect(ss.getSyncState(userId)).rejects.toThrow('getSyncState: db error');
  });

  test('NoopProgressEmitter emits without throwing', async () => {
    const emitter = new NoopProgressEmitter();
    await expect(
      emitter.emit('any-user', { phase: 'backfill', processed: 0, target: 1000, batchSize: 0, done: false }),
    ).resolves.toBeUndefined();
  });
});
