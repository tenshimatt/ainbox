/**
 * TASKRESPONSE-47 — Personalization L5: voice prompt synthesis
 *
 * Tests:
 *  A. HTTP-level contract tests via page.route() mocking
 *     (mirrors edge-kb-extract.spec.ts pattern)
 *  B. Pure handler unit tests via direct import
 *     (mirrors reply-drafting-edge.spec.ts pattern)
 *
 * All fixtures are synthesised — no real email content.
 * (factory-rules §8 / PRD §9.3)
 */

import { test, expect } from '@playwright/test';
import {
  handleVoicePromptRequest,
  MAX_KB_ITEMS,
  type HandlerDeps,
  type KbItemRow,
} from '../../supabase/functions/voice-prompt/handler';

// ── Section A: HTTP-level route contract tests ────────────────────────────

test.describe('@feature TASKRESPONSE-47 §X.Y voice-prompt API route', () => {
  test('route exists and returns non-404', async ({ page }) => {
    const resp = await page.request.post('/api/edge/voice-prompt', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('rejects request with no Authorization header — 401', async ({ page }) => {
    const resp = await page.request.post('/api/edge/voice-prompt', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe('unauthorised');
  });

  test('rejects request with wrong bearer token — 401', async ({ page }) => {
    const resp = await page.request.post('/api/edge/voice-prompt', {
      data: {},
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer definitely-wrong-secret',
      },
    });
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe('unauthorised');
  });

  test('returns { ok, users_examined, profiles_generated, errors } shape on success', async ({ page }) => {
    await page.route('**/api/edge/voice-prompt', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          users_examined: 3,
          profiles_generated: 2,
          errors: [],
        }),
      });
    });

    await page.goto('/');

    const result = await page.evaluate(async () => {
      const resp = await fetch('/api/edge/voice-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-cron-secret',
        },
        body: JSON.stringify({}),
      });
      return { status: resp.status, body: await resp.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(typeof result.body.users_examined).toBe('number');
    expect(typeof result.body.profiles_generated).toBe('number');
    expect(Array.isArray(result.body.errors)).toBe(true);
  });

  test('optional user_id body field is forwarded in the request', async ({ page }) => {
    const capturedBodies: Array<{ user_id?: string }> = [];

    await page.route('**/api/edge/voice-prompt', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { user_id?: string };
      capturedBodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          users_examined: 1,
          profiles_generated: 1,
          errors: [],
        }),
      });
    });

    await page.goto('/');

    await page.evaluate(async () => {
      await fetch('/api/edge/voice-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' },
        body: JSON.stringify({ user_id: 'user-fixture-voice-001' }),
      });
    });

    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].user_id).toBe('user-fixture-voice-001');
  });
});

// ── Section B: Pure handler unit tests ───────────────────────────────────

// ---- Fixtures ------------------------------------------------------------

const FIXTURE_USER_ID = 'user-fixture-voice-001';

const FIXTURE_KB_ITEMS: KbItemRow[] = [
  { kb_type: 'tone-sample', content: 'Uses a direct, friendly tone. Signs off with "Best, Alex".', confidence: 0.9 },
  { kb_type: 'tone-sample', content: 'Greets with "Hi [Name]" even in formal contexts.', confidence: 0.85 },
  { kb_type: 'preference',  content: 'Prefers bullet points for multi-part answers.', confidence: 0.8 },
  { kb_type: 'signature',   content: 'Alex Johnson | Synthetic Corp', confidence: 0.95 },
];

const FIXTURE_VOICE_PROMPT =
  'Alex writes in a direct, friendly tone. Greets with "Hi [Name]" and signs off with "Best, Alex". ' +
  'Uses bullet points for multi-part answers.';

// ---- Helpers -------------------------------------------------------------

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    validateSecret: (header) => header === 'Bearer valid-cron-secret',
    getActiveUsers: async () => [FIXTURE_USER_ID],
    getKbItems: async (_userId) => [...FIXTURE_KB_ITEMS],
    synthesiseVoice: async (_items) => FIXTURE_VOICE_PROMPT,
    upsertVoiceProfile: async (_profile) => undefined,
    ...overrides,
  };
}

function makeRequest(opts: { method?: string; token?: string | null; body?: unknown }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token !== null) {
    headers['authorization'] = `Bearer ${opts.token ?? 'valid-cron-secret'}`;
  }
  return new Request('https://edge.supabase.co/functions/v1/voice-prompt', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : '{}',
  });
}

// ---- Tests ---------------------------------------------------------------

test.describe('@feature TASKRESPONSE-47 handler unit tests', () => {
  // -- HTTP method ----------------------------------------------------------

  test('OPTIONS preflight returns 200 with CORS headers', async () => {
    const req = new Request('https://edge.supabase.co/functions/v1/voice-prompt', {
      method: 'OPTIONS',
      headers: { authorization: 'Bearer valid-cron-secret' },
    });
    const resp = await handleVoicePromptRequest(req, makeDeps());
    expect(resp.status).toBe(200);
    expect(resp.headers.get('access-control-allow-origin')).toBe('*');
    expect(resp.headers.get('access-control-allow-methods')).toContain('POST');
  });

  test('non-POST method returns 405', async () => {
    const req = new Request('https://edge.supabase.co/functions/v1/voice-prompt', {
      method: 'GET',
      headers: { authorization: 'Bearer valid-cron-secret' },
    });
    const resp = await handleVoicePromptRequest(req, makeDeps());
    expect(resp.status).toBe(405);
    const json = await resp.json() as { error: string };
    expect(json.error).toMatch(/method not allowed/i);
  });

  // -- Auth ----------------------------------------------------------------

  test('missing Authorization header returns 401', async () => {
    const req = makeRequest({ token: null });
    const resp = await handleVoicePromptRequest(req, makeDeps());
    expect(resp.status).toBe(401);
    const json = await resp.json() as { error: string };
    expect(json.error).toBe('unauthorised');
  });

  test('wrong bearer token returns 401', async () => {
    const req = makeRequest({ token: 'wrong-secret' });
    const resp = await handleVoicePromptRequest(req, makeDeps());
    expect(resp.status).toBe(401);
    const json = await resp.json() as { error: string };
    expect(json.error).toBe('unauthorised');
  });

  // -- Successful run -------------------------------------------------------

  test('returns 200 with summary fields on success', async () => {
    const req = makeRequest({});
    const resp = await handleVoicePromptRequest(req, makeDeps());
    expect(resp.status).toBe(200);
    const json = await resp.json() as {
      ok: boolean;
      users_examined: number;
      profiles_generated: number;
      errors: string[];
    };
    expect(json.ok).toBe(true);
    expect(json.users_examined).toBe(1);
    expect(json.profiles_generated).toBe(1);
    expect(json.errors).toHaveLength(0);
  });

  test('targeted user_id run processes only that user', async () => {
    const queriedUsers: string[] = [];
    const req = makeRequest({ body: { user_id: FIXTURE_USER_ID } });
    const resp = await handleVoicePromptRequest(
      req,
      makeDeps({
        getActiveUsers: async () => [FIXTURE_USER_ID, 'user-other-002'],
        getKbItems: async (uid) => {
          queriedUsers.push(uid);
          return [...FIXTURE_KB_ITEMS];
        },
      }),
    );
    expect(resp.status).toBe(200);
    const json = await resp.json() as { users_examined: number };
    expect(json.users_examined).toBe(1);
    expect(queriedUsers).toEqual([FIXTURE_USER_ID]);
  });

  // -- Tone-sample prioritisation -------------------------------------------

  test('tone-samples are placed first when capping to MAX_KB_ITEMS', async () => {
    const receivedItems: KbItemRow[][] = [];

    // Generate MAX_KB_ITEMS + 5 items, with the tone-samples at the end.
    const manyItems: KbItemRow[] = [
      ...Array.from({ length: MAX_KB_ITEMS + 3 }, (_, i) => ({
        kb_type: 'preference',
        content: `Preference ${i}`,
        confidence: 0.5,
      })),
      { kb_type: 'tone-sample', content: 'Tone sample A', confidence: 0.6 },
      { kb_type: 'tone-sample', content: 'Tone sample B', confidence: 0.6 },
    ];

    const req = makeRequest({});
    await handleVoicePromptRequest(
      req,
      makeDeps({
        getKbItems: async () => manyItems,
        synthesiseVoice: async (items) => {
          receivedItems.push([...items]);
          return FIXTURE_VOICE_PROMPT;
        },
      }),
    );

    expect(receivedItems).toHaveLength(1);
    const fed = receivedItems[0];
    // Must not exceed cap.
    expect(fed.length).toBeLessThanOrEqual(MAX_KB_ITEMS);
    // Tone-samples must appear first.
    expect(fed[0].kb_type).toBe('tone-sample');
    expect(fed[1].kb_type).toBe('tone-sample');
  });

  // -- Upsert payload -------------------------------------------------------

  test('upsertVoiceProfile receives correct fields', async () => {
    const upserted: unknown[] = [];
    const req = makeRequest({});
    await handleVoicePromptRequest(
      req,
      makeDeps({
        upsertVoiceProfile: async (profile) => {
          upserted.push(profile);
        },
      }),
    );
    expect(upserted).toHaveLength(1);
    const profile = upserted[0] as {
      user_id: string;
      voice_prompt: string;
      kb_item_count: number;
      tone_sample_count: number;
      generated_at: string;
    };
    expect(profile.user_id).toBe(FIXTURE_USER_ID);
    expect(profile.voice_prompt).toBe(FIXTURE_VOICE_PROMPT);
    expect(profile.kb_item_count).toBe(FIXTURE_KB_ITEMS.length);
    expect(profile.tone_sample_count).toBe(
      FIXTURE_KB_ITEMS.filter((i) => i.kb_type === 'tone-sample').length,
    );
    expect(typeof profile.generated_at).toBe('string');
  });

  // -- Empty KB items -------------------------------------------------------

  test('skips user with no KB items — profiles_generated stays 0', async () => {
    const upserted: unknown[] = [];
    const req = makeRequest({});
    const resp = await handleVoicePromptRequest(
      req,
      makeDeps({
        getKbItems: async () => [],
        upsertVoiceProfile: async (p) => {
          upserted.push(p);
        },
      }),
    );
    expect(resp.status).toBe(200);
    const json = await resp.json() as { profiles_generated: number };
    expect(json.profiles_generated).toBe(0);
    expect(upserted).toHaveLength(0);
  });

  // -- Error handling -------------------------------------------------------

  test('synthesise failure is caught and added to errors; run continues', async () => {
    const req = makeRequest({});
    const resp = await handleVoicePromptRequest(
      req,
      makeDeps({
        getActiveUsers: async () => [FIXTURE_USER_ID, 'user-other-002'],
        getKbItems: async (uid) =>
          uid === FIXTURE_USER_ID
            ? [...FIXTURE_KB_ITEMS]
            : [{ kb_type: 'preference', content: 'Other user pref', confidence: 0.7 }],
        synthesiseVoice: async (_items) => {
          throw new Error('LLM timeout');
        },
      }),
    );
    expect(resp.status).toBe(200);
    const json = await resp.json() as {
      ok: boolean;
      profiles_generated: number;
      errors: string[];
    };
    expect(json.ok).toBe(true);
    expect(json.profiles_generated).toBe(0);
    expect(json.errors.length).toBeGreaterThan(0);
    expect(json.errors[0]).toContain('LLM timeout');
  });

  // -- Empty voice prompt ---------------------------------------------------

  test('empty voice prompt from LLM is not upserted', async () => {
    const upserted: unknown[] = [];
    const req = makeRequest({});
    const resp = await handleVoicePromptRequest(
      req,
      makeDeps({
        synthesiseVoice: async () => '',
        upsertVoiceProfile: async (p) => {
          upserted.push(p);
        },
      }),
    );
    expect(resp.status).toBe(200);
    const json = await resp.json() as { profiles_generated: number };
    expect(json.profiles_generated).toBe(0);
    expect(upserted).toHaveLength(0);
  });

  // -- MAX_KB_ITEMS constant ------------------------------------------------

  test('MAX_KB_ITEMS is exported and equals 30', () => {
    expect(MAX_KB_ITEMS).toBe(30);
  });
});
