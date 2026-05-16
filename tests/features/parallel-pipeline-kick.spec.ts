/**
 * TASK7544-79: Parallel pipeline kick on first sync — meet 4-min time-to-first-draft.
 *
 * Tests cover:
 *   - kickPipeline calls classify then draft edge functions
 *   - classify failure is non-fatal (draft still attempted)
 *   - draft failure is non-fatal (result still returned)
 *   - network error on classify is non-fatal
 *   - Gmail backfill calls pipelineKick exactly once after first batch
 *   - Gmail backfill does NOT call pipelineKick when mailbox is empty
 *   - Gmail backfill pipelineKick error does not abort the backfill
 *   - Outlook backfill calls pipelineKick exactly once after first page
 *   - Outlook backfill does NOT call pipelineKick when mailbox is empty
 *
 * No real network calls. No real PII. Fixtures use @ainbox.test TLD.
 */

import { test, expect } from '@playwright/test';
import { kickPipeline, makePipelineKick, type PipelineKickDeps } from '../../src/lib/sync/pipeline-kick';
import {
  runGmailBackfill,
  type GmailLikeClient,
  type SyncStorage,
  type ProgressEmitter,
  type PersistedMessageRow,
  type SyncProgressPayload,
} from '../../src/lib/sync/gmail';
import { runOutlookBackfill, type OutlookSyncDeps, type PersistedMessage } from '../../src/lib/sync/outlook';

// Stable test encryption key (32 bytes, never real).
process.env.AINBOX_ENC_MASTER_KEY ??= Buffer.alloc(32, 0xab).toString('base64');

// ---------------------------------------------------------------------------
// kickPipeline unit tests
// ---------------------------------------------------------------------------

test.describe('@feature TASK7544-79 kickPipeline', () => {
  function makeDeps(
    overrides: Partial<{ classifyStatus: number; draftStatus: number; classifyThrows: boolean; draftThrows: boolean }> = {},
  ): { deps: PipelineKickDeps; calls: string[] } {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('/classify')) {
        calls.push('classify');
        if (overrides.classifyThrows) throw new Error('classify network error');
        return new Response('{}', { status: overrides.classifyStatus ?? 200 });
      }
      if (url.includes('/draft')) {
        calls.push('draft');
        if (overrides.draftThrows) throw new Error('draft network error');
        return new Response('{}', { status: overrides.draftStatus ?? 200 });
      }
      return new Response('{}', { status: 200 });
    };
    return {
      calls,
      deps: {
        supabaseUrl: 'https://proj.supabase.co',
        cronSecret: 'test-cron-secret',
        fetchFn,
      },
    };
  }

  test('calls classify then draft in order', async () => {
    const { deps, calls } = makeDeps();
    const result = await kickPipeline('user-kick-001', deps);
    expect(calls).toEqual(['classify', 'draft']);
    expect(result.classifyOk).toBe(true);
    expect(result.draftOk).toBe(true);
  });

  test('classify HTTP failure is non-fatal — draft still runs', async () => {
    const { deps, calls } = makeDeps({ classifyStatus: 500 });
    const result = await kickPipeline('user-kick-002', deps);
    expect(calls).toEqual(['classify', 'draft']);
    expect(result.classifyOk).toBe(false);
    expect(result.draftOk).toBe(true);
  });

  test('draft HTTP failure is non-fatal — result still returned', async () => {
    const { deps, calls } = makeDeps({ draftStatus: 500 });
    const result = await kickPipeline('user-kick-003', deps);
    expect(calls).toEqual(['classify', 'draft']);
    expect(result.classifyOk).toBe(true);
    expect(result.draftOk).toBe(false);
  });

  test('classify network throw is non-fatal — draft still runs', async () => {
    const { deps, calls } = makeDeps({ classifyThrows: true });
    const result = await kickPipeline('user-kick-004', deps);
    expect(calls).toEqual(['classify', 'draft']);
    expect(result.classifyOk).toBe(false);
    expect(result.draftOk).toBe(true);
  });

  test('draft network throw is non-fatal — result still returned', async () => {
    const { deps, calls } = makeDeps({ draftThrows: true });
    const result = await kickPipeline('user-kick-005', deps);
    expect(calls).toEqual(['classify', 'draft']);
    expect(result.classifyOk).toBe(true);
    expect(result.draftOk).toBe(false);
  });

  test('sends Authorization header with cron secret', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const fetchFn: typeof fetch = async (_input, init) => {
      capturedHeaders.push(Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}),
      ));
      return new Response('{}', { status: 200 });
    };
    await kickPipeline('user-kick-006', {
      supabaseUrl: 'https://proj.supabase.co',
      cronSecret: 'my-secret-123',
      fetchFn,
    });
    expect(capturedHeaders.length).toBe(2);
    for (const h of capturedHeaders) {
      expect(h['Authorization']).toBe('Bearer my-secret-123');
    }
  });

  test('makePipelineKick returns a function that resolves without throwing', async () => {
    const { deps } = makeDeps();
    const kick = makePipelineKick(deps);
    await expect(kick('user-kick-007')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gmail backfill pipelineKick integration
// ---------------------------------------------------------------------------

function synthGmailMessage(i: number) {
  return {
    id: `gm-${i}`,
    threadId: `gt-${Math.floor(i / 5)}`,
    historyId: String(5000 + i),
    internalDate: String(1_700_000_000_000 + i * 60_000),
    sizeEstimate: 200 + i,
    labelIds: ['INBOX'],
    payload: {
      headers: [
        { name: 'From', value: `sender-${i}@ainbox.test` },
        { name: 'To', value: 'inbox@ainbox.test' },
        { name: 'Subject', value: `Kick test subject ${i}` },
      ],
      body: {
        data: Buffer.from(`Kick test body ${i}`, 'utf8').toString('base64url'),
      },
    },
  };
}

function makeGmailClient(messages: ReturnType<typeof synthGmailMessage>[]): GmailLikeClient {
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
        async list() {
          return { data: { history: [], historyId: '5000' } };
        },
      },
    },
  };
}

function makeMemoryStorage(): { storage: SyncStorage; rows: PersistedMessageRow[] } {
  const rows: PersistedMessageRow[] = [];
  return {
    rows,
    storage: {
      async persistMessage(row) {
        const idx = rows.findIndex((r) => r.user_id === row.user_id && r.gmail_id === row.gmail_id);
        if (idx >= 0) rows[idx] = row; else rows.push(row);
      },
      async updateSyncState() {},
      async getSyncState() { return null; },
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

test.describe('@feature TASK7544-79 Gmail backfill pipelineKick', () => {
  test('pipelineKick is called exactly once after first batch', async () => {
    const messages = Array.from({ length: 5 }, (_, i) => synthGmailMessage(i));
    const { storage } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    let kickCount = 0;
    const pipelineKick = async (_userId: string) => { kickCount++; };

    await runGmailBackfill('kick-gmail-001', {
      gmail: makeGmailClient(messages),
      storage,
      progress,
      sleep: async () => {},
      pipelineKick,
    });

    expect(kickCount).toBe(1);
  });

  test('pipelineKick receives the correct userId', async () => {
    const messages = Array.from({ length: 3 }, (_, i) => synthGmailMessage(i));
    const { storage } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    const kickedWith: string[] = [];
    const pipelineKick = async (uid: string) => { kickedWith.push(uid); };

    await runGmailBackfill('kick-gmail-002', {
      gmail: makeGmailClient(messages),
      storage,
      progress,
      sleep: async () => {},
      pipelineKick,
    });

    expect(kickedWith).toEqual(['kick-gmail-002']);
  });

  test('pipelineKick NOT called when mailbox is empty', async () => {
    const { storage } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    let kickCount = 0;
    const pipelineKick = async () => { kickCount++; };

    await runGmailBackfill('kick-gmail-003', {
      gmail: makeGmailClient([]),
      storage,
      progress,
      sleep: async () => {},
      pipelineKick,
    });

    expect(kickCount).toBe(0);
  });

  test('pipelineKick error does not abort the backfill', async () => {
    const messages = Array.from({ length: 4 }, (_, i) => synthGmailMessage(i));
    const { storage, rows } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    const pipelineKick = async () => { throw new Error('kick exploded'); };

    // Should not throw despite pipelineKick failing
    await expect(
      runGmailBackfill('kick-gmail-004', {
        gmail: makeGmailClient(messages),
        storage,
        progress,
        sleep: async () => {},
        pipelineKick,
      }),
    ).resolves.toBeDefined();

    // All messages still persisted
    expect(rows.length).toBe(4);
  });

  test('works fine when pipelineKick is not provided (undefined)', async () => {
    const messages = Array.from({ length: 3 }, (_, i) => synthGmailMessage(i));
    const { storage, rows } = makeMemoryStorage();
    const { progress } = makeMemoryProgress();

    const result = await runGmailBackfill('kick-gmail-005', {
      gmail: makeGmailClient(messages),
      storage,
      progress,
      sleep: async () => {},
      // pipelineKick intentionally omitted
    });

    expect(result.processed).toBe(3);
    expect(rows.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Outlook backfill pipelineKick integration
// ---------------------------------------------------------------------------

function makeOutlookDeps(
  messages: Array<{ id: string; subject: string }>,
  pipelineKick?: (userId: string) => Promise<void>,
): OutlookSyncDeps {
  const rows: PersistedMessage[] = [];
  let page = 0;

  return {
    userId: 'kick-outlook-user',
    getAccessToken: async () => 'fake-access-token',
    persistMessage: async (row) => { rows.push(row); },
    saveDeltaToken: async () => {},
    loadDeltaToken: async () => null,
    sleep: async () => {},
    pipelineKick,
    // Inject a fake Graph client that returns the messages in one page
    client: {
      api: (url: string) => ({
        get: async () => {
          if (url.includes('/delta')) {
            // Return a delta link immediately
            return { value: [], '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=xxx' };
          }
          // First page: return messages, no next link
          if (page === 0) {
            page++;
            return {
              value: messages.map((m) => ({
                id: m.id,
                subject: m.subject,
                receivedDateTime: new Date().toISOString(),
                from: { emailAddress: { address: 'sender@ainbox.test' } },
                body: { content: `Outlook kick test body for ${m.id}` },
                internetMessageId: `<${m.id}@ainbox.test>`,
                conversationId: `conv-${m.id}`,
              })),
            };
          }
          return { value: [] };
        },
      }),
    } as OutlookSyncDeps['client'],
    // Override encrypt to avoid async import during tests
    encryptForUser: async (_userId: string, plaintext: string) => `enc:${plaintext}`,
  };
}

test.describe('@feature TASK7544-79 Outlook backfill pipelineKick', () => {
  test('pipelineKick is called exactly once after first page', async () => {
    let kickCount = 0;
    const pipelineKick = async () => { kickCount++; };

    const deps = makeOutlookDeps(
      [{ id: 'om-1', subject: 'Test subject 1' }, { id: 'om-2', subject: 'Test subject 2' }],
      pipelineKick,
    );

    await runOutlookBackfill(deps);

    expect(kickCount).toBe(1);
  });

  test('pipelineKick receives correct userId', async () => {
    const kickedWith: string[] = [];
    const pipelineKick = async (uid: string) => { kickedWith.push(uid); };

    const deps = makeOutlookDeps(
      [{ id: 'om-3', subject: 'Test subject 3' }],
      pipelineKick,
    );

    await runOutlookBackfill(deps);

    expect(kickedWith).toEqual(['kick-outlook-user']);
  });

  test('pipelineKick NOT called when mailbox is empty', async () => {
    let kickCount = 0;
    const pipelineKick = async () => { kickCount++; };

    const deps = makeOutlookDeps([], pipelineKick);

    await runOutlookBackfill(deps);

    expect(kickCount).toBe(0);
  });

  test('pipelineKick error does not abort the Outlook backfill', async () => {
    const pipelineKick = async () => { throw new Error('outlook kick failed'); };

    const deps = makeOutlookDeps(
      [{ id: 'om-4', subject: 'Test subject 4' }],
      pipelineKick,
    );

    await expect(runOutlookBackfill(deps)).resolves.toBeDefined();
  });

  test('works fine when pipelineKick is not provided (undefined)', async () => {
    const deps = makeOutlookDeps([{ id: 'om-5', subject: 'Test subject 5' }]);

    const result = await runOutlookBackfill(deps);
    expect(result.persisted).toBeGreaterThanOrEqual(1);
  });
});
