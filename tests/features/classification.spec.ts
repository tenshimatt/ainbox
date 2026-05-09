/**
 * AINBOX-9 — Inbound classification engine
 * PRD §7.9
 *
 * Verifies:
 *   - classifyEmail() calls LiteLLM (mocked) and parses structured output
 *   - a sales-y email yields category=sales with a numeric confidence
 *   - batch helper persists category + classified_at and writes audit_log
 *
 * Synthesised @ainbox.test fixtures only — no real email content.
 */

import { test, expect } from '@playwright/test';
import { classifyEmail, VALID_CATEGORIES } from '../../src/lib/classify/classify';
import { classifyPendingForUser, type MinimalSupabaseLike } from '../../src/lib/classify/batch';

function mockLiteLLMFetch(category: string, confidence: number) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({ category, confidence }),
              },
            },
          ],
        };
      },
      async text() {
        return '';
      },
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

test.describe('@feature §7.9 classification engine', () => {
  test('classifyEmail returns one of the 10 valid categories', async () => {
    const { fetchImpl } = mockLiteLLMFetch('sales', 0.92);

    const result = await classifyEmail(
      {
        id: 'msg-1',
        subject: 'Interested in your enterprise plan pricing',
        body: 'Hi team, can you share pricing tiers and a demo slot? Thanks.',
        from: 'prospect@ainbox.test',
      },
      { fetchImpl, baseUrl: 'http://mock', apiKey: 'k' },
    );

    expect(VALID_CATEGORIES).toContain(result.category);
    expect(result.category).toBe('sales');
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test('classifyEmail clamps out-of-range confidence and falls back to "other"', async () => {
    const { fetchImpl } = mockLiteLLMFetch('not-a-real-category', 5);
    const result = await classifyEmail(
      { id: 'x', subject: 's', body: 'b', from: 'a@ainbox.test' },
      { fetchImpl, baseUrl: 'http://mock', apiKey: 'k' },
    );
    expect(result.category).toBe('other');
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  test('classifyEmail sends model + structured output instruction to LiteLLM', async () => {
    const { fetchImpl, calls } = mockLiteLLMFetch('support', 0.81);
    await classifyEmail(
      { id: 'x', subject: 'help', body: 'i cannot log in', from: 'user@ainbox.test' },
      { fetchImpl, baseUrl: 'http://mock', apiKey: 'k' },
    );
    expect(calls).toHaveLength(1);
    const body = calls[0].body as { model: string; response_format?: { type: string } };
    expect(body.model).toBe('deepseek-v4-pro');
    expect(body.response_format?.type).toBe('json_object');
  });

  test('batch helper persists category + classified_at and writes audit_log', async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const audits: Array<Record<string, unknown>> = [];

    const pending = [
      {
        id: 'e1',
        subject: 'Quote request for 50 seats',
        body: 'Looking to buy.',
        from_address: 'buyer@ainbox.test',
      },
      {
        id: 'e2',
        subject: 'Login broken',
        body: 'Cannot reset password',
        from_address: 'user@ainbox.test',
      },
    ];

    let selectCalled = 0;

    const supabase: MinimalSupabaseLike = {
      from(table: string) {
        if (table === 'email_messages') {
          return {
            select() {
              return {
                eq() {
                  return {
                    is() {
                      return {
                        async limit() {
                          selectCalled += 1;
                          return { data: pending, error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
            update(patch: Record<string, unknown>) {
              return {
                async eq(_col: string, val: unknown) {
                  updates.push({ id: String(val), patch });
                  return { error: null };
                },
              };
            },
            async insert() {
              return { error: null };
            },
          };
        }
        if (table === 'audit_log') {
          return {
            select() {
              return {
                eq() {
                  return {
                    is() {
                      return { async limit() { return { data: [], error: null }; } };
                    },
                  };
                },
              };
            },
            update() {
              return { async eq() { return { error: null }; } };
            },
            async insert(row: Record<string, unknown>) {
              audits.push(row);
              return { error: null };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    let n = 0;
    const classifier = async (email: { subject?: string | null }) => {
      n += 1;
      const isSalesy = /quote|seats|pricing|buy/i.test(email.subject ?? '');
      return {
        category: (isSalesy ? 'sales' : 'support') as 'sales' | 'support',
        confidence: isSalesy ? 0.9 : 0.7,
      };
    };

    const result = await classifyPendingForUser(supabase, 'user-123', 25, { classifier });

    expect(selectCalled).toBe(1);
    expect(n).toBe(2);
    expect(result.total).toBe(2);
    expect(result.classified).toBe(2);
    expect(result.failed).toBe(0);

    expect(updates).toHaveLength(2);
    const e1 = updates.find((u) => u.id === 'e1');
    expect(e1?.patch.category).toBe('sales');
    expect(typeof e1?.patch.classified_at).toBe('string');

    expect(audits).toHaveLength(2);
    expect(audits[0].action).toBe('classify');
    expect(audits[0].user_id).toBe('user-123');
    expect(['sales', 'support']).toContain(audits[0].category);
    expect(typeof audits[0].confidence).toBe('number');
  });
});
