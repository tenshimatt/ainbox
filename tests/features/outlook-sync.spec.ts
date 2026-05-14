/**
 * TASKRESPONSE-6 — Outlook (MS Graph) sync + delta
 * PRD §3.8 §4.2 §4.3 §7.4 §7.5 §7.17 §7.18
 *
 * These tests mock Microsoft Graph at the SDK boundary by injecting a fake
 * Client. Bodies must never appear in plaintext on the persisted row, the
 * delta token must be persisted after backfill, and the pacer must hold the
 * worker below 10k requests / 10 minutes.
 *
 * No real email content — synthesised fixtures only (factory-rule §8 / PRD §6).
 */

import { test, expect } from '@playwright/test';
import type { Client } from '@microsoft/microsoft-graph-client';
import {
  GraphPacer,
  runOutlookBackfill,
  runOutlookIncremental,
  type PersistedMessage,
} from '../../src/lib/sync/outlook';

// ---------- Synthesised fixtures (no real addresses) ----------
function fakeMessage(i: number) {
  return {
    id: `msg-${i}`,
    subject: `synthetic subject ${i}`,
    receivedDateTime: new Date(2026, 4, 1, 0, 0, i).toISOString(),
    from: {
      emailAddress: {
        address: `synthetic-sender-${i % 3}.invalid`, // .invalid TLD per RFC 2606
        name: `Synthetic Sender ${i % 3}`,
      },
    },
    body: { contentType: 'text', content: `synthetic-body-content-${i}` },
    bodyPreview: `synthetic preview ${i}`,
    internetMessageId: `<synthetic-${i}@local.invalid>`,
    conversationId: `conv-${Math.floor(i / 5)}`,
  };
}

// ---------- Fake Graph client builder ----------
interface PageSpec {
  value: ReturnType<typeof fakeMessage>[];
  nextLink?: string;
  deltaLink?: string;
}

function buildFakeClient(pagesByUrl: Record<string, PageSpec>): {
  client: Client;
  callCount: () => number;
  urlsCalled: () => string[];
} {
  const calls: string[] = [];
  const client = {
    api(url: string) {
      calls.push(url);
      return {
        async get() {
          const spec =
            pagesByUrl[url] ??
            pagesByUrl[Object.keys(pagesByUrl).find((k) => url.startsWith(k)) ?? ''];
          if (!spec) {
            throw Object.assign(new Error(`no fixture for ${url}`), {
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
  return {
    client,
    callCount: () => calls.length,
    urlsCalled: () => calls.slice(),
  };
}

// Fake encrypt function — passed to the worker via the `encryptForUser` dep.
// TASKRESPONSE-5 owns the real implementation; we test the worker's contract here.
const fakeEncrypt = async (userId: string, plaintext: string) =>
  `enc(${userId}):${Buffer.from(plaintext).toString('base64')}`;

// ---------- Tests ----------
test.describe('@feature §7.4 §7.5 outlook sync worker', () => {
  test('GraphPacer holds below 10k req / 10 min sliding window (§7.18)', () => {
    const pacer = new GraphPacer();
    const t0 = 1_700_000_000_000;
    // Fill to soft-limit (9000) — next call should require a wait.
    for (let i = 0; i < 9000; i++) pacer.record(t0 + i);
    expect(pacer.size(t0 + 9000)).toBe(9000);
    expect(pacer.delayBeforeNext(t0 + 9000)).toBeGreaterThan(0);

    // After window slides, no wait required.
    const future = t0 + 11 * 60 * 1000;
    expect(pacer.size(future)).toBe(0);
    expect(pacer.delayBeforeNext(future)).toBe(0);
  });

  test('GraphPacer pacing kicks in: many timestamps -> non-zero wait', () => {
    const pacer = new GraphPacer(10_000, 5); // shrink for test
    for (let i = 0; i < 5; i++) pacer.record(1000 + i);
    expect(pacer.delayBeforeNext(1010)).toBeGreaterThan(0);
  });

  test('§7.4 backfill paginates to 1000 messages and encrypts every body', async () => {
    

    // Build 11 pages: 10 of 100 messages + one initial delta page.
    const pagesByUrl: Record<string, PageSpec> = {};
    let cursor: string | null = '/me/messages?$top=100';
    let firstUrl = cursor;
    for (let p = 0; p < 11; p++) {
      const startIdx = p * 100;
      const value = Array.from({ length: 100 }, (_, k) => fakeMessage(startIdx + k));
      const next = p < 10 ? `https://graph.microsoft.com/v1.0/me/messages?$skip=${(p + 1) * 100}` : undefined;
      pagesByUrl[cursor!] = { value, nextLink: next };
      cursor = next ?? null;
    }
    // delta seed page (returned after backfill)
    pagesByUrl['/me/messages/delta?$top=100'] = {
      value: [],
      deltaLink: 'https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=SEED-TOKEN',
    };

    // Match by prefix — fake client matches the first page literally.
    const fake = buildFakeClient({
      ...pagesByUrl,
      // Allow the worker to use any URL it constructs that begins with the literal first URL prefix
    });
    // Re-register with prefix matching for the full $select query string variant.
    // Replace our fake with a smarter resolver:
    const resolver = (url: string) => {
      if (pagesByUrl[url]) return pagesByUrl[url];
      // worker's first call includes $select; match prefix.
      if (url.startsWith('/me/messages?$top=100')) return pagesByUrl['/me/messages?$top=100'];
      if (url.startsWith('/me/messages/delta')) return pagesByUrl['/me/messages/delta?$top=100'];
      // nextLinks are absolute graph URLs
      const found = Object.entries(pagesByUrl).find(([, v]) => v.nextLink === url);
      if (found) return pagesByUrl[found[1].nextLink!] ?? pagesByUrl[found[0]];
      return undefined;
    };
    const calls: string[] = [];
    const client = {
      api(url: string) {
        calls.push(url);
        return {
          async get() {
            const spec = resolver(url) ?? pagesByUrl[url];
            if (!spec) throw new Error(`no fixture for ${url}`);
            const out: Record<string, unknown> = { value: spec.value };
            if (spec.nextLink) out['@odata.nextLink'] = spec.nextLink;
            if (spec.deltaLink) out['@odata.deltaLink'] = spec.deltaLink;
            return out;
          },
        };
      },
    } as unknown as Client;

    const persisted: PersistedMessage[] = [];
    let savedDelta: string | null = null;

    const result = await runOutlookBackfill({
      userId: 'user-test-1',
      getAccessToken: async () => 'fake-access-token',
      encryptForUser: fakeEncrypt,
      client,
      persistMessage: async (row) => {
        persisted.push(row);
      },
      saveDeltaToken: async (t) => {
        savedDelta = t;
      },
      loadDeltaToken: async () => null,
      sleep: async () => {
        /* no-op for tests */
      },
    });

    // Backfill cap is 1000.
    expect(result.persisted).toBe(1000);
    expect(persisted.length).toBe(1000);

    // Every persisted row carries an encrypted body, never plaintext.
    for (const row of persisted) {
      expect(row.body_encrypted.startsWith('enc(user-test-1):')).toBe(true);
      // Plaintext synthetic-body-content-N must NOT appear in the encrypted column.
      expect(row.body_encrypted).not.toContain('synthetic-body-content');
      expect(row.user_id).toBe('user-test-1');
      expect(row.provider).toBe('outlook');
    }

    // Delta token persisted post-backfill (§7.5).
    expect(savedDelta).toBe(
      'https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=SEED-TOKEN',
    );

    // We made roughly 11 graph calls (10 pages of 100 + 1 delta seed).
    expect(calls.length).toBeLessThanOrEqual(12);
    // And nowhere near the 10k/10min ceiling.
    expect(calls.length).toBeLessThan(10_000);
  });

  test('§7.5 incremental sync uses persisted delta token and updates it', async () => {
    

    const initialToken =
      'https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=PRIOR';
    const newToken =
      'https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=NEW-AFTER-POLL';

    const calls: string[] = [];
    const client = {
      api(url: string) {
        calls.push(url);
        return {
          async get() {
            // Single page with two new messages then deltaLink.
            return {
              value: [fakeMessage(9001), fakeMessage(9002)],
              '@odata.deltaLink': newToken,
            };
          },
        };
      },
    } as unknown as Client;

    const persisted: PersistedMessage[] = [];
    let savedDelta: string | null = null;

    const result = await runOutlookIncremental({
      userId: 'user-test-2',
      getAccessToken: async () => 'fake-access-token',
      encryptForUser: fakeEncrypt,
      client,
      persistMessage: async (row) => {
        persisted.push(row);
      },
      saveDeltaToken: async (t) => {
        savedDelta = t;
      },
      loadDeltaToken: async () => initialToken,
      sleep: async () => {
        /* no-op */
      },
    });

    // The first call must be the persisted delta token (not a fresh /delta path).
    expect(calls[0]).toBe(initialToken);
    expect(result.persisted).toBe(2);
    expect(persisted.length).toBe(2);
    expect(savedDelta).toBe(newToken);
    expect(result.deltaToken).toBe(newToken);

    // Bodies are encrypted, not plaintext.
    for (const row of persisted) {
      expect(row.body_encrypted).not.toContain('synthetic-body-content');
      expect(row.body_encrypted.startsWith('enc(user-test-2):')).toBe(true);
    }
  });

  test('§7.17 retries on 429 with Retry-After then succeeds', async () => {
    

    let attempt = 0;
    const client = {
      api(_url: string) {
        return {
          async get() {
            attempt += 1;
            if (attempt === 1) {
              throw Object.assign(new Error('throttled'), {
                statusCode: 429,
                headers: { 'retry-after': '0' },
              });
            }
            return {
              value: [fakeMessage(1)],
              '@odata.deltaLink':
                'https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=AFTER-RETRY',
            };
          },
        };
      },
    } as unknown as Client;

    const persisted: PersistedMessage[] = [];
    let savedDelta: string | null = null;

    const result = await runOutlookIncremental({
      userId: 'user-test-3',
      getAccessToken: async () => 'fake-access-token',
      encryptForUser: fakeEncrypt,
      client,
      persistMessage: async (row) => persisted.push(row),
      saveDeltaToken: async (t) => {
        savedDelta = t;
      },
      loadDeltaToken: async () => null,
      sleep: async () => {
        /* no-op */
      },
    });

    expect(attempt).toBe(2); // one throttle, one success
    expect(result.persisted).toBe(1);
    expect(savedDelta).toContain('AFTER-RETRY');
  });
});
