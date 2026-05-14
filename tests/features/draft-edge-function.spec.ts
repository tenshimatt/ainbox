/**
 * TASKRESPONSE-22 — Edge function: draft — generate AI draft replies via LiteLLM
 *
 * PRD: §7.10 Reply drafting
 *      §4.4 Confidence model
 *
 * Tests the `generateDraftForEmail` orchestration helper:
 *   - fetches email, searches KB via RPC, calls LLM, persists draft, writes audit log
 *   - confidence = min(retrieval_score, generation_score) carried through to draft row
 *   - throws on missing email or DB fetch failure
 *   - throws on draft persist failure
 *   - audit log failure is non-fatal — result is still returned
 *
 * No real email content in fixtures (factory-rules §8 / PRD §9.3).
 */

import { test, expect } from '@playwright/test';
import {
  generateDraftForEmail,
  type GenerateDraftSupabaseLike,
} from '../../src/lib/draft/generate';

// ---- synthesised fixtures (no real PII) ----

const FIXTURE_USER_ID = 'user-taskresponse22-fixture-001';
const FIXTURE_EMAIL_ID = 'email-taskresponse22-fixture-001';
const FIXTURE_DRAFT_ID = 'draft-taskresponse22-fixture-001';

const FIXTURE_EMAIL_ROW = {
  id: FIXTURE_EMAIL_ID,
  user_id: FIXTURE_USER_ID,
  subject: 'Synthetic question about support SLA',
  body_preview: 'Fully synthesised body used only in TASKRESPONSE-22 tests.',
  sender: 'synthetic at taskresponse.test',
  category: 'support',
};

const FIXTURE_KB_RPC_DATA = [
  { id: 'kb-taskresponse22-a', content: 'Support SLA is 24h for standard tier.', similarity: 0.88 },
  { id: 'kb-taskresponse22-b', content: 'Support contacts are available 9–5 weekdays.', similarity: 0.72 },
];

// ---- mock builders ----

/**
 * Build a Supabase-like mock that serves `email_messages`, `drafts`,
 * and `audit_log` tables and a `match_kb_items` RPC.
 *
 * The `email_messages` mock supports two chain shapes:
 *   - .select().eq().eq().maybeSingle()          ← email fetch
 *   - .select().eq().eq().order().limit()         ← loadSampleSent
 */
function makeSupabase(opts: {
  emailRow?: typeof FIXTURE_EMAIL_ROW | null;
  kbData?: typeof FIXTURE_KB_RPC_DATA;
  insertedDraftId?: string;
  draftInserts?: Record<string, unknown>[];
  auditInserts?: Record<string, unknown>[];
  fetchError?: { message: string } | null;
  insertError?: { message: string } | null;
}): GenerateDraftSupabaseLike {
  const draftInserts = opts.draftInserts ?? [];
  const auditInserts = opts.auditInserts ?? [];
  const emailRow = 'emailRow' in opts ? opts.emailRow : FIXTURE_EMAIL_ROW;
  const kbData = opts.kbData ?? FIXTURE_KB_RPC_DATA;
  const draftId = opts.insertedDraftId ?? FIXTURE_DRAFT_ID;

  // Reusable terminal node supporting both .maybeSingle() and .order().limit()
  const terminal = () => ({
    async maybeSingle() {
      if (opts.fetchError) return { data: null, error: opts.fetchError };
      return { data: emailRow ?? null, error: null };
    },
    order(_col: string, _opts?: unknown) {
      return {
        limit: (_n: number) => Promise.resolve({ data: [], error: null }),
      };
    },
  });

  return {
    from(table: string) {
      if (table === 'email_messages') {
        return {
          select(_cols: string) {
            return {
              eq(_c: string, _v: unknown) {
                return {
                  ...terminal(),
                  eq(_c2: string, _v2: unknown) {
                    return terminal();
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'drafts') {
        return {
          insert(row: Record<string, unknown>) {
            draftInserts.push(row);
            return {
              select(_cols: string) {
                return {
                  async single() {
                    if (opts.insertError) return { data: null, error: opts.insertError };
                    return { data: { id: draftId }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'audit_log') {
        return {
          async insert(row: Record<string, unknown>) {
            auditInserts.push(row);
            return { error: null };
          },
        };
      }

      throw new Error(`makeSupabase: unexpected table "${table}"`);
    },

    async rpc(_fn: string, _params: Record<string, unknown>) {
      return { data: kbData, error: null };
    },
  };
}

/** Mock LLM that returns a synthetic draft body and self-rated generation_score. */
function makeCallLlm(body = 'Synthetic draft reply from TASKRESPONSE-22 test.', generationScore = 0.78) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (_prompt: any) => ({ body, generation_score: generationScore });
}

/** Mock embedder that returns a single zero-filled 1024-dim vector. */
function makeEmbedder() {
  return async (_chunks: string[]): Promise<number[][]> => [new Array(1024).fill(0.01)];
}

// ---- tests ----

test.describe('@feature TASKRESPONSE-22 generateDraftForEmail', () => {
  test('§7.10 generates a draft, persists to drafts table, and writes audit log', async () => {
    const draftInserts: Record<string, unknown>[] = [];
    const auditInserts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({ draftInserts, auditInserts });

    const result = await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      { callLlm: makeCallLlm(), embedder: makeEmbedder() },
    );

    // Result shape
    expect(result.draft_id).toBeTruthy();
    expect(typeof result.draft_id).toBe('string');
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.kb_items_used)).toBe(true);
    expect(result.kb_items_used).toContain('kb-taskresponse22-a');
    expect(result.kb_items_used).toContain('kb-taskresponse22-b');
    expect(typeof result.created_at).toBe('string');

    // Draft row persisted with correct fields
    expect(draftInserts).toHaveLength(1);
    expect(draftInserts[0]).toMatchObject({
      user_id: FIXTURE_USER_ID,
      in_reply_to: FIXTURE_EMAIL_ID,
      status: 'pending',
      category: 'support',
    });
    expect(typeof (draftInserts[0] as Record<string, unknown>).body).toBe('string');
    expect(typeof (draftInserts[0] as Record<string, unknown>).confidence).toBe('number');

    // Audit log written with correct fields
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      user_id: FIXTURE_USER_ID,
      event_type: 'draft_generated',
      model: 'deepseek-v4-pro',
    });
    expect((auditInserts[0] as Record<string, unknown>).target_id).toBe(FIXTURE_DRAFT_ID);
  });

  test('§4.4 confidence = min(retrieval_score, generation_score) carried to draft row', async () => {
    const draftInserts: Record<string, unknown>[] = [];
    // KB max similarity = 0.88; generation_score = 0.50 → confidence = 0.50
    const supabase = makeSupabase({ draftInserts });

    const result = await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      { callLlm: makeCallLlm(undefined, 0.50), embedder: makeEmbedder() },
    );

    expect(result.retrieval_score).toBeCloseTo(0.88, 5);
    expect(result.generation_score).toBeCloseTo(0.50, 5);
    expect(result.confidence).toBeCloseTo(0.50, 5);
    // Confidence in persisted draft matches
    expect((draftInserts[0] as Record<string, unknown>).confidence).toBeCloseTo(0.50, 5);
    // Sanity: confidence is NOT the average
    const avg = (0.88 + 0.50) / 2;
    expect(result.confidence).not.toBeCloseTo(avg, 3);
  });

  test('§4.4 confidence uses retrieval_score when it is the smaller value', async () => {
    // Override KB to return a low similarity score
    const lowKb = [
      { id: 'kb-low', content: 'sparse coverage', similarity: 0.30 },
    ];
    const supabase = makeSupabase({ kbData: lowKb });

    const result = await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      { callLlm: makeCallLlm(undefined, 0.95), embedder: makeEmbedder() },
    );

    expect(result.retrieval_score).toBeCloseTo(0.30, 5);
    expect(result.generation_score).toBeCloseTo(0.95, 5);
    expect(result.confidence).toBeCloseTo(0.30, 5);
  });

  test('§7.10 throws when email is not found', async () => {
    const supabase = makeSupabase({ emailRow: null });

    await expect(
      generateDraftForEmail(
        supabase,
        FIXTURE_USER_ID,
        'email-missing-taskresponse22',
        { callLlm: makeCallLlm(), embedder: makeEmbedder() },
      ),
    ).rejects.toThrow(/not found/);
  });

  test('§7.10 throws when DB fetch returns an error', async () => {
    const supabase = makeSupabase({ fetchError: { message: 'connection reset' } });

    await expect(
      generateDraftForEmail(
        supabase,
        FIXTURE_USER_ID,
        FIXTURE_EMAIL_ID,
        { callLlm: makeCallLlm(), embedder: makeEmbedder() },
      ),
    ).rejects.toThrow(/fetch failed/);
  });

  test('§7.10 throws when draft insert fails', async () => {
    const supabase = makeSupabase({ insertError: { message: 'unique constraint' } });

    await expect(
      generateDraftForEmail(
        supabase,
        FIXTURE_USER_ID,
        FIXTURE_EMAIL_ID,
        { callLlm: makeCallLlm(), embedder: makeEmbedder() },
      ),
    ).rejects.toThrow(/persist failed/);
  });

  test('§7.10 audit log failure is non-fatal — draft result still returned', async () => {
    const baseSupabase = makeSupabase({});
    const originalFrom = baseSupabase.from.bind(baseSupabase);

    // Override audit_log insert to throw
    const supabase: GenerateDraftSupabaseLike = {
      ...baseSupabase,
      from(table: string) {
        if (table === 'audit_log') {
          return {
            insert: async () => { throw new Error('audit log storage failure'); },
          };
        }
        return originalFrom(table);
      },
    };

    const result = await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      { callLlm: makeCallLlm(), embedder: makeEmbedder() },
    );

    // Draft still returned despite audit log failure
    expect(result.draft_id).toBeTruthy();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  test('§4.4 confidence is 0 when KB returns no items', async () => {
    const supabase = makeSupabase({ kbData: [] });

    const result = await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      { callLlm: makeCallLlm(undefined, 0.9), embedder: makeEmbedder() },
    );

    expect(result.retrieval_score).toBe(0);
    expect(result.confidence).toBe(0); // min(0, 0.9)
    expect(result.kb_items_used).toEqual([]);
  });

  test('§7.10 draft body comes from LLM output', async () => {
    const draftInserts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({ draftInserts });
    const expectedBody = 'Thank you for reaching out. Our SLA is 24 hours — synthesised reply.';

    await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      { callLlm: makeCallLlm(expectedBody, 0.82), embedder: makeEmbedder() },
    );

    expect((draftInserts[0] as Record<string, unknown>).body).toBe(expectedBody);
  });
});
