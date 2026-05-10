/**
 * AINBOX-29 — §7.10 Reply drafting (edge function)
 *
 * PRD: §7.10 Reply drafting
 *      §4.4  Confidence model
 *
 * Tests the pure HTTP handler exported from
 * supabase/functions/draft/handler.ts.
 *
 * All fixtures are synthesised — no real email content.
 * (factory-rules §8 / PRD §9.3)
 */

import { test, expect } from '@playwright/test';
import {
  handleDraftRequest,
  SKIP_CATEGORIES,
  type HandlerDeps,
  type EmailRow,
  type DraftResult,
} from '../../supabase/functions/draft/handler';

// ---- Fixtures -----------------------------------------------------------

const FIXTURE_USER = { id: 'user-fixture-edge-001' };

const FIXTURE_EMAIL: EmailRow = {
  id: 'email-fixture-edge-001',
  user_id: FIXTURE_USER.id,
  subject: 'Synthetic question about widget pricing',
  body: 'This is a fully synthesised inbound email used only in tests.',
  from_address: 'sender at synthetic dot test',
  category: 'support',
  provider: 'gmail',
};

const FIXTURE_DRAFT_RESULT: DraftResult = {
  body: 'Synthetic draft reply for widget pricing.',
  retrieval_score: 0.88,
  generation_score: 0.75,
  confidence: 0.75, // min(0.88, 0.75)
  kb_items_used: ['kb-fixture-1', 'kb-fixture-2'],
};

// ---- Helpers ------------------------------------------------------------

function makeRequest(opts: {
  method?: string;
  jwt?: string | null;
  body?: unknown;
}): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.jwt !== null) {
    headers['authorization'] = `Bearer ${opts.jwt ?? 'valid-jwt-token'}`;
  }
  return new Request('https://edge.supabase.co/functions/v1/draft', {
    method: opts.method ?? 'POST',
    headers,
    body:
      opts.body !== undefined ? JSON.stringify(opts.body) : JSON.stringify({ email_id: FIXTURE_EMAIL.id }),
  });
}

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getUser: async (_jwt) => FIXTURE_USER,
    getEmail: async (_userId, _emailId) => FIXTURE_EMAIL,
    draftFn: async (_email) => ({ ...FIXTURE_DRAFT_RESULT }),
    insertDraft: async (_row) => ({ id: 'draft-fixture-edge-001' }),
    updateDraftProvider: async (_draftId, _providerDraftId) => undefined,
    createProviderDraft: async (_userId, provider, _body) => ({
      provider_draft_id: `placeholder-${provider}-abcd1234-42`,
      is_placeholder: true,
    }),
    logAudit: async (_entry) => undefined,
    ...overrides,
  };
}

// ---- Tests --------------------------------------------------------------

test.describe('@feature AINBOX-29 §7.10 reply drafting edge function', () => {
  // -- HTTP method --------------------------------------------------------

  test('OPTIONS preflight returns 200 with CORS headers', async () => {
    const req = makeRequest({ method: 'OPTIONS' });
    const resp = await handleDraftRequest(req, makeDeps());
    expect(resp.status).toBe(200);
    expect(resp.headers.get('access-control-allow-origin')).toBe('*');
    expect(resp.headers.get('access-control-allow-methods')).toContain('POST');
  });

  test('non-POST method returns 405', async () => {
    // GET requests cannot carry a body — build the Request manually.
    const req = new Request('https://edge.supabase.co/functions/v1/draft', {
      method: 'GET',
      headers: { authorization: 'Bearer valid-jwt-token' },
    });
    const resp = await handleDraftRequest(req, makeDeps());
    expect(resp.status).toBe(405);
    const json = await resp.json() as { error: string };
    expect(json.error).toMatch(/method not allowed/i);
  });

  // -- Auth ---------------------------------------------------------------

  test('missing Authorization header returns 401', async () => {
    const req = makeRequest({ jwt: null });
    const resp = await handleDraftRequest(req, makeDeps());
    expect(resp.status).toBe(401);
    const json = await resp.json() as { error: string };
    expect(json.error).toMatch(/unauthenticated/i);
  });

  test('invalid JWT (getUser returns null) returns 401', async () => {
    const req = makeRequest({ jwt: 'bad-token' });
    const resp = await handleDraftRequest(
      req,
      makeDeps({ getUser: async () => null }),
    );
    expect(resp.status).toBe(401);
    const json = await resp.json() as { error: string };
    expect(json.error).toMatch(/unauthenticated/i);
  });

  // -- Input validation ---------------------------------------------------

  test('missing email_id returns 400', async () => {
    const req = makeRequest({ body: {} });
    const resp = await handleDraftRequest(req, makeDeps());
    expect(resp.status).toBe(400);
    const json = await resp.json() as { error: string };
    expect(json.error).toMatch(/email_id/i);
  });

  test('non-string email_id returns 400', async () => {
    const req = makeRequest({ body: { email_id: 42 } });
    const resp = await handleDraftRequest(req, makeDeps());
    expect(resp.status).toBe(400);
  });

  test('invalid JSON body returns 400', async () => {
    const req = new Request('https://edge.supabase.co/functions/v1/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer tok' },
      body: 'not-json',
    });
    const resp = await handleDraftRequest(req, makeDeps());
    expect(resp.status).toBe(400);
    const json = await resp.json() as { error: string };
    expect(json.error).toMatch(/invalid json/i);
  });

  // -- Email lookup -------------------------------------------------------

  test('email not found returns 404', async () => {
    const req = makeRequest({});
    const resp = await handleDraftRequest(
      req,
      makeDeps({ getEmail: async () => null }),
    );
    expect(resp.status).toBe(404);
    const json = await resp.json() as { error: string };
    expect(json.error).toMatch(/not found/i);
  });

  // -- Category skipping (PRD §7.10) -------------------------------------

  for (const category of Array.from(SKIP_CATEGORIES)) {
    test(`category '${category}' is skipped — returns 200 with skipped=true`, async () => {
      const skippedEmail: EmailRow = { ...FIXTURE_EMAIL, category };
      const req = makeRequest({});
      const resp = await handleDraftRequest(
        req,
        makeDeps({ getEmail: async () => skippedEmail }),
      );
      expect(resp.status).toBe(200);
      const json = await resp.json() as { skipped: boolean; reason: string };
      expect(json.skipped).toBe(true);
      expect(json.reason).toContain(category);
    });
  }

  test('non-skip category (support) proceeds to drafting', async () => {
    const req = makeRequest({});
    const resp = await handleDraftRequest(req, makeDeps());
    expect(resp.status).toBe(201);
  });

  // -- Successful draft ---------------------------------------------------

  test('§7.10 successful draft returns 201 with scores and ids', async () => {
    const req = makeRequest({});
    const resp = await handleDraftRequest(req, makeDeps());
    expect(resp.status).toBe(201);

    const json = await resp.json() as {
      draft_id: string;
      retrieval_score: number;
      generation_score: number;
      confidence: number;
      kb_items_used: string[];
      provider_draft_id: string;
    };

    expect(json.draft_id).toBe('draft-fixture-edge-001');
    expect(json.retrieval_score).toBeCloseTo(0.88, 5);
    expect(json.generation_score).toBeCloseTo(0.75, 5);
    expect(json.confidence).toBeCloseTo(0.75, 5);
    expect(json.kb_items_used).toEqual(['kb-fixture-1', 'kb-fixture-2']);
    expect(json.provider_draft_id).toMatch(/^placeholder-gmail-/);
  });

  test('§4.4 confidence recorded is MIN of retrieval and generation scores', async () => {
    const highRetrieval: DraftResult = {
      body: 'Synthetic reply.',
      retrieval_score: 0.95,
      generation_score: 0.45,
      confidence: 0.45,
      kb_items_used: [],
    };
    const req = makeRequest({});
    const resp = await handleDraftRequest(
      req,
      makeDeps({ draftFn: async () => highRetrieval }),
    );
    const json = await resp.json() as { confidence: number };
    expect(json.confidence).toBeCloseTo(0.45, 5);
    // Verify it is NOT the average (0.70).
    expect(json.confidence).not.toBeCloseTo((0.95 + 0.45) / 2, 3);
  });

  // -- Provider routing ---------------------------------------------------

  test('outlook provider email gets placeholder-outlook provider draft id', async () => {
    const outlookEmail: EmailRow = { ...FIXTURE_EMAIL, provider: 'outlook' };
    const req = makeRequest({});
    const resp = await handleDraftRequest(
      req,
      makeDeps({ getEmail: async () => outlookEmail }),
    );
    const json = await resp.json() as { provider_draft_id: string };
    expect(json.provider_draft_id).toMatch(/^placeholder-outlook-/);
  });

  test('null provider defaults to gmail', async () => {
    const nullProviderEmail: EmailRow = { ...FIXTURE_EMAIL, provider: null };
    const req = makeRequest({});
    const resp = await handleDraftRequest(
      req,
      makeDeps({ getEmail: async () => nullProviderEmail }),
    );
    const json = await resp.json() as { provider_draft_id: string };
    expect(json.provider_draft_id).toMatch(/^placeholder-gmail-/);
  });

  // -- Side effects -------------------------------------------------------

  test('insertDraft receives correct fields', async () => {
    const insertedRows: unknown[] = [];
    const req = makeRequest({});
    await handleDraftRequest(
      req,
      makeDeps({
        insertDraft: async (row) => {
          insertedRows.push(row);
          return { id: 'draft-check-001' };
        },
      }),
    );
    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0] as {
      user_id: string;
      email_id: string;
      status: string;
      confidence: number;
    };
    expect(row.user_id).toBe(FIXTURE_USER.id);
    expect(row.email_id).toBe(FIXTURE_EMAIL.id);
    expect(row.status).toBe('pending');
    expect(typeof row.confidence).toBe('number');
  });

  test('logAudit called once with correct action and no email body', async () => {
    const auditEntries: unknown[] = [];
    const req = makeRequest({});
    await handleDraftRequest(
      req,
      makeDeps({
        logAudit: async (entry) => {
          auditEntries.push(entry);
        },
      }),
    );
    expect(auditEntries).toHaveLength(1);
    const entry = auditEntries[0] as {
      action: string;
      user_id: string;
      metadata: Record<string, unknown>;
    };
    expect(entry.action).toBe('draft.created');
    expect(entry.user_id).toBe(FIXTURE_USER.id);
    // Verify no body content in audit metadata.
    expect(JSON.stringify(entry.metadata)).not.toContain('synthesised inbound email');
  });

  test('updateDraftProvider called with correct draft id and provider draft id', async () => {
    const updates: Array<[string, string]> = [];
    const req = makeRequest({});
    await handleDraftRequest(
      req,
      makeDeps({
        updateDraftProvider: async (draftId, providerDraftId) => {
          updates.push([draftId, providerDraftId]);
        },
      }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toBe('draft-fixture-edge-001');
    expect(updates[0][1]).toMatch(/^placeholder-/);
  });
});
