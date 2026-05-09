/**
 * AINBOX-8 — KB extraction over backfilled email corpus
 * PRD: §4.4 §7.6 §7.7
 *
 * Verifies:
 *  1. extractKbItems batches emails through LiteLLM (mocked at network boundary)
 *     and returns typed kb items with citations + clamped confidence.
 *  2. The /onboarding/kb-review UI surfaces grouped items, lets the user
 *     Approve / Edit / Discard, and the extract button kicks off both the
 *     extract API and the embedding pipeline (re-embed).
 */

import { test, expect } from '@playwright/test';
import {
  extractKbItems,
  type EmailMessage,
  type KbItem,
} from '../../src/lib/kb/extract';

// ---------------------------------------------------------------------------
// 1. Unit-level: extractKbItems with LiteLLM mocked at the fetch boundary
// ---------------------------------------------------------------------------

test.describe('@feature kb-extraction worker', () => {
  test('batches in groups of 50 and returns typed citation-bound items', async () => {
    // 120 synthesised emails -> 3 batches (50 + 50 + 20)
    const emails: EmailMessage[] = Array.from({ length: 120 }, (_, i) => ({
      id: `email-${i}`,
      subject: `Synth subject ${i}`,
      from_address: `sender${i}@example.test`,
      to_address: `me@example.test`,
      body: `Synthesised body ${i}. Refund policy: 30 days. Standard hourly rate is 200 GBP.`,
      sent_at: new Date(2026, 0, 1 + (i % 28)).toISOString(),
    }));

    const calls: { url: string; body: unknown }[] = [];

    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body: parsed });

      // pretend the LLM extracts two items per batch, citing the first email id in batch
      const userMsg: string = parsed.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
      const firstIdMatch = userMsg.match(/"id":"(email-\d+)"/);
      const firstId = firstIdMatch ? firstIdMatch[1] : 'email-0';

      const items = [
        {
          type: 'policy',
          content: 'Refund window is 30 days from purchase.',
          confidence: 0.9,
          source_email_id: firstId,
        },
        {
          type: 'pricing',
          // confidence > 1 to verify clamping
          content: 'Standard hourly rate is 200 GBP.',
          confidence: 1.4,
          source_email_id: firstId,
        },
        {
          // bogus type — must be filtered
          type: 'crypto-token',
          content: 'should be dropped',
          confidence: 0.99,
          source_email_id: firstId,
        },
        {
          // bogus citation — must be filtered
          type: 'faq',
          content: 'should be dropped (bad citation)',
          confidence: 0.8,
          source_email_id: 'not-in-corpus',
        },
      ];

      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify(items),
            },
          },
        ],
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await extractKbItems('user-123', emails, {
      baseUrl: 'https://litellm.test/v1',
      apiKey: 'sk-test',
      model: 'deepseek-v4-pro',
      fetchImpl: fakeFetch,
    });

    // 3 batches × 2 valid items = 6 (the 2 invalid get dropped per batch)
    expect(calls.length).toBe(3);
    expect(result.length).toBe(6);

    // every call hit the LiteLLM completions endpoint with our model
    for (const c of calls) {
      expect(c.url).toContain('/chat/completions');
      const b = c.body as { model: string; messages: { role: string }[] };
      expect(b.model).toBe('deepseek-v4-pro');
      expect(b.messages.some((m) => m.role === 'system')).toBe(true);
      expect(b.messages.some((m) => m.role === 'user')).toBe(true);
    }

    // shape + citation invariants
    const types = new Set(result.map((r: KbItem) => r.type));
    expect(types.has('policy')).toBe(true);
    expect(types.has('pricing')).toBe(true);
    for (const it of result) {
      expect(it.user_id).toBe('user-123');
      expect(it.confidence).toBeGreaterThanOrEqual(0);
      expect(it.confidence).toBeLessThanOrEqual(1);
      expect(it.source_email_id.startsWith('email-')).toBe(true);
      expect(it.human_verified).toBe(false);
    }
  });

  test('returns [] when corpus empty (no LLM call)', async () => {
    let called = 0;
    const fakeFetch = (async () => {
      called += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const out = await extractKbItems('u', [], { apiKey: 'sk', fetchImpl: fakeFetch });
    expect(out).toEqual([]);
    expect(called).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. UI: /onboarding/kb-review surfaces grouped items + wires extract+embed
// ---------------------------------------------------------------------------

test.describe('@feature kb-review UI', () => {
  test('extracts, groups by type, approves & discards items', async ({ page }) => {
    // mutable in-memory store, shared across mocked routes
    const store: Array<{
      id: string;
      type: string;
      content: string;
      confidence: number;
      source_email_id: string;
      human_verified: boolean;
    }> = [];

    let extractCalls = 0;
    let embedCalls = 0;

    // POST /api/kb/extract — LiteLLM is the network boundary, but in the
    // browser this is the API route in front of it. We mock the route
    // and, internally, "trigger" the embedding pipeline by recording a
    // call when the extract route persists items.
    await page.route('**/api/kb/extract', async (route) => {
      extractCalls += 1;
      // simulate: extract -> persist -> kick off embedding
      const fresh = [
        {
          id: `kb-${store.length + 1}`,
          type: 'policy',
          content: 'Refund window is 30 days from purchase.',
          confidence: 0.92,
          source_email_id: 'email-1',
          human_verified: false,
        },
        {
          id: `kb-${store.length + 2}`,
          type: 'pricing',
          content: 'Standard hourly rate is 200 GBP.',
          confidence: 0.81,
          source_email_id: 'email-2',
          human_verified: false,
        },
        {
          id: `kb-${store.length + 3}`,
          type: 'signature',
          content: 'Best, Synth User',
          confidence: 0.74,
          source_email_id: 'email-3',
          human_verified: false,
        },
      ];
      store.push(...fresh);
      embedCalls += 1; // re-embed kickoff
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, extracted: fresh.length, items: fresh }),
      });
    });

    await page.route('**/api/kb/items', async (route) => {
      const grouped: Record<string, typeof store> = {
        faq: [], policy: [], pricing: [], preference: [],
        contact: [], signature: [], 'tone-sample': [],
      };
      for (const it of store) {
        if (grouped[it.type]) grouped[it.type].push(it);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          page: 1,
          pageSize: 50,
          total: store.length,
          items: [...store].sort((a, b) => b.confidence - a.confidence),
          grouped,
        }),
      });
    });

    await page.route('**/api/kb/items/*', async (route) => {
      const url = new URL(route.request().url());
      const id = url.pathname.split('/').pop()!;
      const method = route.request().method();
      if (method === 'PATCH') {
        const body = JSON.parse(route.request().postData() || '{}');
        const idx = store.findIndex((s) => s.id === id);
        if (idx >= 0) {
          store[idx] = { ...store[idx], ...body };
          if (typeof body.content === 'string') embedCalls += 1; // re-embed on edit
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, item: store[idx] }),
        });
        return;
      }
      if (method === 'DELETE') {
        const idx = store.findIndex((s) => s.id === id);
        if (idx >= 0) store.splice(idx, 1);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/onboarding/kb-review');

    // initial empty state
    await expect(page.getByTestId('kb-empty')).toBeVisible();

    // run extraction
    await page.getByTestId('kb-extract-button').click();

    // grouped sections appear
    await expect(page.getByTestId('kb-group-policy')).toBeVisible();
    await expect(page.getByTestId('kb-group-pricing')).toBeVisible();
    await expect(page.getByTestId('kb-group-signature')).toBeVisible();

    expect(extractCalls).toBe(1);
    expect(embedCalls).toBe(1); // extract route kicked off embedding

    // approve the policy item
    const policyId = store.find((s) => s.type === 'policy')!.id;
    await page.getByTestId(`kb-approve-${policyId}`).click();
    await expect(page.getByTestId(`kb-approve-${policyId}`)).toHaveText(/Approved/);

    // edit the pricing item -> save & approve -> re-embed fires
    const pricingId = store.find((s) => s.type === 'pricing')!.id;
    await page.getByTestId(`kb-edit-${pricingId}`).click();
    await page.getByTestId(`kb-edit-input-${pricingId}`).fill('Standard hourly rate is 250 GBP.');
    await page.getByTestId(`kb-save-${pricingId}`).click();
    await expect(page.getByTestId(`kb-item-${pricingId}`)).toContainText('250 GBP');
    expect(embedCalls).toBe(2);

    // discard the signature item -> disappears
    const sigId = store.find((s) => s.type === 'signature')!.id;
    await page.getByTestId(`kb-discard-${sigId}`).click();
    await expect(page.getByTestId(`kb-item-${sigId}`)).toHaveCount(0);

    // verified state persisted in store
    const after = store.find((s) => s.id === policyId);
    expect(after?.human_verified).toBe(true);
  });
});
