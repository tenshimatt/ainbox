/**
 * AINBOX-16 — Edge function: kb-extract
 * PRD: §4.4 §7.6 §7.7
 *
 * Tests the batch-extraction helper (`extractKbForUser`) that the
 * Supabase edge function delegates to. Verifies:
 *
 *  1. Happy path: emails fetched → LiteLLM called → kb_items inserted →
 *     emails marked with kb_extracted_at.
 *  2. Empty corpus: returns early with zero inserts, no LiteLLM call.
 *  3. LiteLLM failure in one batch: that batch is skipped; others succeed.
 *  4. DB insert failure: failedBatches incremented, emails still marked.
 *  5. Confidence clamping and invalid-type filtering are enforced.
 *  6. Extracted item count reflects only successfully inserted items.
 */

import { test, expect } from '@playwright/test';
import {
  extractKbForUser,
  type MinimalSupabaseForKbBatch,
  type KbBatchResult,
} from '../../src/lib/kb/batch';
import { type KbItem, type EmailMessage } from '../../src/lib/kb/extract';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a synthetic email with deterministic ids. */
function makeEmail(i: number): EmailMessage {
  return {
    id: `email-${i}`,
    subject: `Subject ${i}`,
    from_address: `sender${i}@ainbox.test`,
    to_address: 'me@ainbox.test',
    body: `Body text for email ${i}. Policy: 30-day refunds. Rate: £200/hr.`,
    sent_at: new Date(2026, 0, 1 + (i % 28)).toISOString(),
  };
}

/** Build a fake LiteLLM fetch that returns two valid items + two filtered ones. */
function makeFakeFetch(emails: EmailMessage[]) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const parsed = init?.body ? JSON.parse(String(init.body)) : {};
    const userMsg: string =
      parsed.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
    const firstIdMatch = userMsg.match(/"id":"(email-\d+)"/);
    const firstId = firstIdMatch ? firstIdMatch[1] : emails[0].id;

    const items = [
      { type: 'policy', content: 'Refund window is 30 days.', confidence: 0.9, source_email_id: firstId },
      { type: 'pricing', content: 'Standard rate is £200/hr.', confidence: 1.5, source_email_id: firstId },
      // invalid type — must be dropped
      { type: 'crypto-token', content: 'drop me', confidence: 0.9, source_email_id: firstId },
      // bad citation — must be dropped
      { type: 'faq', content: 'drop me too', confidence: 0.8, source_email_id: 'not-in-corpus' },
    ];
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(items) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Minimal Supabase mock. Captures inserts and updates. */
function makeSupabaseMock(opts: {
  emails: EmailMessage[];
  insertError?: string;
}) {
  const inserts: Record<string, unknown>[][] = [];
  const updates: { table: string; patch: Record<string, unknown>; ids: unknown[] }[] = [];

  const mock: MinimalSupabaseForKbBatch = {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                is(_col2: string, _val2: unknown) {
                  return {
                    order(_col3: string, _opts: unknown) {
                      return {
                        async limit(_n: number) {
                          if (table === 'email_messages') {
                            return { data: opts.emails as unknown[], error: null };
                          }
                          return { data: [], error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        insert(rows: Record<string, unknown>[]) {
          return {
            async select(_cols: string) {
              if (opts.insertError) {
                return { data: null, error: { message: opts.insertError } };
              }
              inserts.push(rows);
              return { data: rows, error: null };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            in(col: string, ids: unknown[]) {
              return {
                async eq(_col2: string, _val: unknown) {
                  updates.push({ table, patch, ids });
                  return { error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  return { mock, inserts, updates };
}

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-16 kb-extract edge function — batch helper', () => {
  test('extracts items, inserts to kb_items, marks emails as processed', async () => {
    const emails = Array.from({ length: 5 }, (_, i) => makeEmail(i));
    const { fetchImpl } = makeFakeFetch(emails);
    const { mock, inserts, updates } = makeSupabaseMock({ emails });

    const fixedNow = new Date('2026-01-15T12:00:00.000Z');

    const result: KbBatchResult = await extractKbForUser(mock, 'user-123', {
      now: () => fixedNow,
      extractorOpts: {
        baseUrl: 'https://litellm.test/v1',
        apiKey: 'sk-test',
        model: 'deepseek-v4-pro',
        fetchImpl,
      },
    });

    // Two valid items per batch (invalid type + bad citation are dropped)
    expect(result.user_id).toBe('user-123');
    expect(result.processed_emails).toBe(5);
    expect(result.extracted).toBeGreaterThan(0);
    expect(result.failed_batches).toBe(0);

    // kb_items were inserted
    expect(inserts).toHaveLength(1);
    const inserted = inserts[0];
    for (const row of inserted) {
      expect(row.user_id).toBe('user-123');
      expect(typeof row.content).toBe('string');
      expect((row.confidence as number)).toBeGreaterThanOrEqual(0);
      expect((row.confidence as number)).toBeLessThanOrEqual(1);
      expect(row.human_verified).toBe(false);
    }

    // email_messages.kb_extracted_at was set
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('email_messages');
    expect(updates[0].patch.kb_extracted_at).toBe(fixedNow.toISOString());
    expect(Array.isArray(updates[0].ids)).toBe(true);
    expect((updates[0].ids as string[]).every((id) => id.startsWith('email-'))).toBe(true);
  });

  // ── 2. Empty corpus ────────────────────────────────────────────────────────

  test('returns zero counts and makes no DB writes when corpus is empty', async () => {
    let extractorCalled = false;
    const { mock, inserts, updates } = makeSupabaseMock({ emails: [] });

    const result = await extractKbForUser(mock, 'user-empty', {
      extractorOpts: { apiKey: 'sk' },
      extractor: async () => {
        extractorCalled = true;
        return [];
      },
    });

    expect(result.processed_emails).toBe(0);
    expect(result.extracted).toBe(0);
    expect(result.failed_batches).toBe(0);
    expect(result.items).toEqual([]);
    expect(extractorCalled).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  // ── 3. LiteLLM failure in a batch ─────────────────────────────────────────

  test('logs and skips a failing LiteLLM batch without aborting the job', async () => {
    const emails = Array.from({ length: 3 }, (_, i) => makeEmail(i));
    let callCount = 0;
    const flakyFetch = (async () => {
      callCount += 1;
      if (callCount === 1) return new Response('boom', { status: 503 });
      // subsequent calls succeed with empty extraction
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const { mock } = makeSupabaseMock({ emails });

    // Should not throw even though LiteLLM returns 503
    const result = await extractKbForUser(mock, 'user-flaky', {
      extractorOpts: {
        baseUrl: 'https://litellm.test/v1',
        apiKey: 'sk-test',
        model: 'deepseek-v4-pro',
        fetchImpl: flakyFetch,
      },
    });

    expect(result.processed_emails).toBe(3);
    // extraction returned 0 items (batch was skipped or empty)
    expect(result.extracted).toBe(0);
  });

  // ── 4. DB insert failure ───────────────────────────────────────────────────

  test('records failed_batches when kb_items insert errors', async () => {
    const emails = [makeEmail(0), makeEmail(1)];
    const { mock, updates } = makeSupabaseMock({
      emails,
      insertError: 'unique_violation',
    });

    const items: KbItem[] = [
      {
        user_id: 'user-err',
        type: 'policy',
        content: 'Refund policy: 30 days.',
        confidence: 0.88,
        source_email_id: 'email-0',
        human_verified: false,
      },
    ];

    const result = await extractKbForUser(mock, 'user-err', {
      extractor: async () => items,
    });

    expect(result.failed_batches).toBe(1);
    expect(result.extracted).toBe(0);

    // Emails should still be marked even after insert failure
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.kb_extracted_at).toBeTruthy();
  });

  // ── 5. Confidence clamping and type filtering ──────────────────────────────

  test('clamps confidence to [0,1] and drops unknown types', async () => {
    const emails = [makeEmail(0)];
    const { fetchImpl } = makeFakeFetch(emails);
    const { mock } = makeSupabaseMock({ emails });

    const result = await extractKbForUser(mock, 'user-clamp', {
      extractorOpts: {
        baseUrl: 'https://litellm.test/v1',
        apiKey: 'sk-test',
        model: 'deepseek-v4-pro',
        fetchImpl,
      },
    });

    for (const item of result.items) {
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
      const validTypes = ['faq', 'policy', 'pricing', 'preference', 'contact', 'signature', 'tone-sample'];
      expect(validTypes).toContain(item.type);
    }
  });

  // ── 6. userId required ────────────────────────────────────────────────────

  test('throws when userId is empty string', async () => {
    const { mock } = makeSupabaseMock({ emails: [] });
    await expect(extractKbForUser(mock, '')).rejects.toThrow(/userId required/);
  });
});
