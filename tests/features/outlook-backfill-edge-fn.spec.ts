/**
 * AINBOX-27: §7.4 Outlook backfill edge function — feature spec.
 *
 * PRD: §4.3, §7.4, §7.5, §7.17, §7.18
 *
 * Tests complement outlook-sync.spec.ts by covering:
 *  - Worker behaviour when mailbox has fewer messages than the backfill cap.
 *  - Idempotency: re-persisting the same message replaces, not duplicates.
 *  - subjectHash stability and collision-resistance (§4.3 log safety).
 *  - senderDomain extraction edge cases (§4.3 metadata-only, no PII).
 *  - HTML-body content type handling — encryption wraps raw body.content.
 *  - withRetry escalates to throw after maxAttempts on permanent 4xx errors.
 *
 * No real email addresses — synthesised fixtures only.
 */

import { test, expect } from '@playwright/test';
import {
  runOutlookBackfill,
  __testing,
  type PersistedMessage,
  type OutlookSyncDeps,
} from '../../src/lib/sync/outlook';
import type { Client } from '@microsoft/microsoft-graph-client';

const { subjectHash, senderDomain, withRetry } = __testing;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fakeMsg(i: number, overrides?: Partial<ReturnType<typeof fakeMsg>>) {
  return {
    id: `edge-msg-${i}`,
    subject: `Edge subject ${i}`,
    receivedDateTime: new Date(2026, 4, 1, 0, 0, i).toISOString(),
    from: {
      emailAddress: { address: `sender-${i}@example.invalid`, name: `Sender ${i}` },
    },
    body: { contentType: 'text', content: `Edge body content ${i}` },
    bodyPreview: `Edge preview ${i}`,
    internetMessageId: `<edge-${i}@local.invalid>`,
    conversationId: `conv-${Math.floor(i / 3)}`,
    ...overrides,
  };
}

const fakeEncrypt = async (userId: string, plaintext: string) =>
  `enc(${userId}):${Buffer.from(plaintext).toString('base64')}`;

function buildClient(pages: Array<{
  value: ReturnType<typeof fakeMsg>[];
  nextLink?: string;
  deltaLink?: string;
}>): Client {
  let callIdx = 0;
  const lookup: Record<string, (typeof pages)[number]> = {};
  for (const p of pages) {
    const key = p.nextLink ?? (callIdx === 0 ? 'FIRST' : 'DELTA');
    lookup[key] = p;
    callIdx++;
  }

  return {
    api(url: string) {
      return {
        async get() {
          // First call gets pages[0], then follow nextLinks.
          const spec =
            lookup[url] ??
            (Object.values(lookup).find(
              (p) => p.nextLink === url || url === 'FIRST',
            ) ??
              pages.find((p, idx) => {
                // Resolve by index if url isn't explicitly mapped.
                return idx === 0 && !url.includes('delta');
              }));
          if (!spec) {
            throw Object.assign(new Error(`no fixture for url: ${url}`), {
              statusCode: 404,
            });
          }
          const out: Record<string, unknown> = { value: spec.value };
          if (spec.nextLink) out['@odata.nextLink'] = spec.nextLink;
          if (spec.deltaLink) out['@odata.deltaLink'] = spec.deltaLink;
          return out;
        },
      };
    },
  } as unknown as Client;
}

/** Build a simple deterministic client for small-mailbox tests. */
function singlePageClient(
  messages: ReturnType<typeof fakeMsg>[],
  deltaToken = 'https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=SEED',
): Client {
  return {
    api(url: string) {
      return {
        async get() {
          if (url.includes('delta')) {
            return { value: [], '@odata.deltaLink': deltaToken };
          }
          // Single page of messages, no nextLink.
          return { value: messages };
        },
      };
    },
  } as unknown as Client;
}

const noSleep = async () => { /* no-op */ };

function makeDeps(
  client: Client,
  messages: PersistedMessage[] = [],
  deltaStore: { token: string | null } = { token: null },
): OutlookSyncDeps {
  return {
    userId: 'edge-user-1',
    getAccessToken: async () => 'fake-token',
    encryptForUser: fakeEncrypt,
    client,
    persistMessage: async (row) => { messages.push(row); },
    saveDeltaToken: async (t) => { deltaStore.token = t; },
    loadDeltaToken: async () => deltaStore.token,
    sleep: noSleep,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@feature §7.4 AINBOX-27 Outlook backfill edge function', () => {
  // --- subjectHash ---

  test('subjectHash is stable: same subject always produces same hash', () => {
    const h1 = subjectHash('Re: Q3 budget review');
    const h2 = subjectHash('Re: Q3 budget review');
    expect(h1).toBe(h2);
  });

  test('subjectHash differs for distinct subjects', () => {
    expect(subjectHash('Invoice #1001')).not.toBe(subjectHash('Invoice #1002'));
  });

  test('subjectHash handles null/undefined gracefully', () => {
    expect(subjectHash(null)).toBe(subjectHash(undefined));
    expect(subjectHash(null)).toBe(subjectHash(''));
  });

  test('subjectHash output starts with h (log-safe prefix)', () => {
    expect(subjectHash('any subject')).toMatch(/^h[0-9a-f]+$/);
  });

  // --- senderDomain ---

  test('senderDomain extracts domain from from.emailAddress.address', () => {
    const msg = fakeMsg(0);
    expect(senderDomain(msg)).toBe('example.invalid');
  });

  test('senderDomain is lowercase', () => {
    const msg = { ...fakeMsg(0), from: { emailAddress: { address: 'User@EXAMPLE.invalid' } } };
    expect(senderDomain(msg)).toBe('example.invalid');
  });

  test('senderDomain returns null for missing address', () => {
    expect(senderDomain({})).toBeNull();
    expect(senderDomain({ from: null })).toBeNull();
    expect(senderDomain({ from: { emailAddress: {} } })).toBeNull();
  });

  test('senderDomain returns null for address without @', () => {
    const msg = { from: { emailAddress: { address: 'no-at-sign' } } };
    expect(senderDomain(msg)).toBeNull();
  });

  // --- Small-mailbox backfill (< cap) ---

  test('§7.4 backfill completes when mailbox has fewer than cap messages', async () => {
    const smallMailbox = Array.from({ length: 37 }, (_, i) => fakeMsg(i));
    const client = singlePageClient(smallMailbox);
    const persisted: PersistedMessage[] = [];
    const deltaStore = { token: null as string | null };

    const result = await runOutlookBackfill({
      ...makeDeps(client, persisted, deltaStore),
    });

    expect(result.persisted).toBe(37);
    expect(persisted).toHaveLength(37);
    // Delta token seeded after backfill (§7.5).
    expect(deltaStore.token).toBe(
      'https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=SEED',
    );
  });

  test('§7.4 empty mailbox yields persisted=0 but still seeds delta token', async () => {
    const client = singlePageClient([]);
    const persisted: PersistedMessage[] = [];
    const deltaStore = { token: null as string | null };

    const result = await runOutlookBackfill(makeDeps(client, persisted, deltaStore));

    expect(result.persisted).toBe(0);
    expect(persisted).toHaveLength(0);
    expect(deltaStore.token).not.toBeNull();
  });

  // --- Idempotency ---

  test('§7.4 backfill is idempotent: running twice returns same data', async () => {
    const msgs = Array.from({ length: 5 }, (_, i) => fakeMsg(i));
    const persisted: PersistedMessage[] = [];
    const deltaStore = { token: null as string | null };

    // First run.
    await runOutlookBackfill(makeDeps(singlePageClient(msgs), persisted, deltaStore));
    const firstCount = persisted.length;

    // Second run — replace persisted list to simulate what a DB UPSERT does.
    const persisted2: PersistedMessage[] = [];
    await runOutlookBackfill(makeDeps(singlePageClient(msgs), persisted2, deltaStore));

    // Same count both runs.
    expect(persisted2).toHaveLength(firstCount);
    // Same message IDs.
    const ids1 = persisted.map((r) => r.provider_message_id).sort();
    const ids2 = persisted2.map((r) => r.provider_message_id).sort();
    expect(ids1).toEqual(ids2);
  });

  // --- Body encryption ---

  test('§4.3 HTML body content is encrypted (not stored as plaintext)', async () => {
    const htmlMsg = fakeMsg(0, {
      body: {
        contentType: 'html',
        content: '<html><body><p>Edge HTML body content</p></body></html>',
      },
    });
    const client = singlePageClient([htmlMsg]);
    const persisted: PersistedMessage[] = [];

    await runOutlookBackfill(makeDeps(client, persisted));

    expect(persisted).toHaveLength(1);
    // Encrypted body must not contain plaintext HTML.
    expect(persisted[0].body_encrypted).not.toContain('<html>');
    expect(persisted[0].body_encrypted).not.toContain('Edge HTML body content');
    // Must be in our fake encrypt format (enc(userId):...).
    expect(persisted[0].body_encrypted).toMatch(/^enc\(edge-user-1\):/);
  });

  test('§4.3 null body content is handled (encrypts empty string)', async () => {
    const noBodyMsg = fakeMsg(0, { body: undefined });
    const client = singlePageClient([noBodyMsg]);
    const persisted: PersistedMessage[] = [];

    await runOutlookBackfill(makeDeps(client, persisted));

    expect(persisted).toHaveLength(1);
    // Empty string encrypted — enc(userId): + base64('') = enc(userId):
    const expectedEmptyEncrypted = `enc(edge-user-1):${Buffer.from('').toString('base64')}`;
    expect(persisted[0].body_encrypted).toBe(expectedEmptyEncrypted);
  });

  // --- PersistedMessage shape ---

  test('persisted row carries correct metadata fields', async () => {
    const msg = fakeMsg(42);
    const client = singlePageClient([msg]);
    const persisted: PersistedMessage[] = [];

    await runOutlookBackfill(makeDeps(client, persisted));

    expect(persisted).toHaveLength(1);
    const row = persisted[0];
    expect(row.provider).toBe('outlook');
    expect(row.user_id).toBe('edge-user-1');
    expect(row.provider_message_id).toBe('edge-msg-42');
    expect(row.internet_message_id).toBe('<edge-42@local.invalid>');
    expect(row.conversation_id).toBe('conv-14');
    expect(row.sender_domain).toBe('example.invalid');
    expect(row.received_at).not.toBeNull();
    // subject_hash is a hex string, not the raw subject.
    expect(row.subject_hash).toMatch(/^h[0-9a-f]+$/);
    expect(row.subject_hash).not.toContain('Edge subject');
  });

  // --- withRetry (re-exported via __testing) ---

  test('§7.17 withRetry throws immediately on non-transient 4xx', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    };
    await expect(withRetry(fn, noSleep, 6)).rejects.toThrow('forbidden');
    // 4xx is not transient — should throw on first attempt.
    expect(attempts).toBe(1);
  });

  test('§7.17 withRetry succeeds after transient 500 on second attempt', async () => {
    let attempts = 0;
    const fn = async (): Promise<string> => {
      attempts++;
      if (attempts === 1) {
        throw Object.assign(new Error('server error'), { statusCode: 500 });
      }
      return 'ok';
    };
    const result = await withRetry(fn, noSleep, 3);
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  test('§7.17 withRetry exhausts maxAttempts on persistent 503', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw Object.assign(new Error('service unavailable'), { statusCode: 503 });
    };
    await expect(withRetry(fn, noSleep, 3)).rejects.toThrow('service unavailable');
    expect(attempts).toBe(3);
  });
});
