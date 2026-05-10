/**
 * AINBOX-29 — §7.10 Reply drafting (edge function)
 *
 * PRD: §4.4 Confidence model
 *      §7.10 Reply drafting — "except spam/escalation/urgent"
 *
 * Unit-level Playwright spec (no browser). Verifies the pure
 * `processDraftForEmail()` worker:
 *   - SKIP_CATEGORIES constant matches PRD §7.10
 *   - shouldSkipCategory() gate works for all three skip values
 *   - Valid-category emails generate + persist a draft
 *   - Draft row persisted with correct scores (confidence = min formula)
 *   - Audit log written with metadata only (no body — PRD §6.1 / §9.3)
 *   - createProviderDraft is called with the email's provider
 *   - DB insert failure surfaces as a thrown error
 *
 * Synthesised fixtures only — no real email content (factory-rules §8).
 */

import { test, expect } from '@playwright/test';
import {
  SKIP_CATEGORIES,
  shouldSkipCategory,
  processDraftForEmail,
  type WorkerEmailRow,
  type WorkerDeps,
  type WorkerSkipped,
  type WorkerResult,
} from '../../src/lib/draft/worker';

// ---- synthesised fixture helpers (no real PII) ----

function makeEmailRow(overrides: Partial<WorkerEmailRow> = {}): WorkerEmailRow {
  return {
    id: 'email-fixture-edge-001',
    user_id: 'user-fixture-edge-001',
    subject: 'Synthetic question about widget availability',
    body: 'This is a fully synthesised inbound message used only in tests.',
    from_address: null,
    category: 'sales',
    provider: 'gmail',
    ...overrides,
  };
}

function makeDeps(opts: {
  generationScore?: number;
  body?: string;
}): WorkerDeps {
  return {
    searchKb: async () => [
      { id: 'kb-edge-1', content: 'Synthesised KB: Widget X is in stock.', score: 0.88 },
      { id: 'kb-edge-2', content: 'Synthesised KB: Delivery takes 3–5 days.', score: 0.75 },
    ],
    loadSampleSent: async () => [
      { subject: 'Re: synthetic prior thread', body: 'Confirmed, will process today.' },
    ],
    callLlm: async () => ({
      body: opts.body ?? 'Synthesised draft reply for edge function test.',
      generation_score: opts.generationScore ?? 0.78,
    }),
  };
}

function makeSupabase(opts: {
  draftId?: string;
  insertFails?: boolean;
  drafts?: Record<string, unknown>[];
  auditLogs?: Record<string, unknown>[];
}) {
  const { draftId = 'draft-edge-mock-001', insertFails = false } = opts;
  return {
    from(table: string) {
      if (table === 'drafts') {
        return {
          insert(row: Record<string, unknown>) {
            opts.drafts?.push(row);
            return {
              select(_cols: string) {
                return {
                  async single() {
                    if (insertFails) {
                      return { data: null, error: { message: 'insert failed (test stub)' } };
                    }
                    return { data: { id: draftId }, error: null };
                  },
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            void patch;
            return {
              async eq(_col: string, _val: unknown) {
                return { error: null };
              },
            };
          },
        };
      }
      if (table === 'audit_log') {
        return {
          insert(row: Record<string, unknown>) {
            opts.auditLogs?.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`makeSupabase: unexpected table "${table}"`);
    },
  };
}

// ---- constant + gate tests ----

test.describe('@feature AINBOX-29 §7.10 SKIP_CATEGORIES constant', () => {
  test('SKIP_CATEGORIES contains exactly spam, escalation, urgent', () => {
    expect(SKIP_CATEGORIES).toContain('spam');
    expect(SKIP_CATEGORIES).toContain('escalation');
    expect(SKIP_CATEGORIES).toContain('urgent');
    expect(SKIP_CATEGORIES).toHaveLength(3);
  });

  test('shouldSkipCategory returns true for all skip values', () => {
    expect(shouldSkipCategory('spam')).toBe(true);
    expect(shouldSkipCategory('escalation')).toBe(true);
    expect(shouldSkipCategory('urgent')).toBe(true);
  });

  test('shouldSkipCategory returns false for non-skip categories', () => {
    expect(shouldSkipCategory('sales')).toBe(false);
    expect(shouldSkipCategory('support')).toBe(false);
    expect(shouldSkipCategory('meeting')).toBe(false);
    expect(shouldSkipCategory('other')).toBe(false);
    expect(shouldSkipCategory(null)).toBe(false);
    expect(shouldSkipCategory(undefined)).toBe(false);
    expect(shouldSkipCategory('')).toBe(false);
  });
});

// ---- skip-category gate ----

test.describe('@feature AINBOX-29 §7.10 skip-category gate', () => {
  test('skips spam email without touching DB', async () => {
    const email = makeEmailRow({ category: 'spam' });
    const drafts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({ drafts });

    const result = await processDraftForEmail(email, supabase, makeDeps({}));

    expect((result as WorkerSkipped).skipped).toBe(true);
    expect((result as WorkerSkipped).skip_reason).toContain('spam');
    // DB must NOT be touched for skip
    expect(drafts).toHaveLength(0);
  });

  test('skips escalation email without touching DB', async () => {
    const email = makeEmailRow({ category: 'escalation' });
    const drafts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({ drafts });

    const result = await processDraftForEmail(email, supabase, makeDeps({}));

    expect((result as WorkerSkipped).skipped).toBe(true);
    expect((result as WorkerSkipped).skip_reason).toContain('escalation');
    expect(drafts).toHaveLength(0);
  });

  test('skips urgent email without touching DB', async () => {
    const email = makeEmailRow({ category: 'urgent' });
    const drafts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({ drafts });

    const result = await processDraftForEmail(email, supabase, makeDeps({}));

    expect((result as WorkerSkipped).skipped).toBe(true);
    expect((result as WorkerSkipped).skip_reason).toContain('urgent');
    expect(drafts).toHaveLength(0);
  });
});

// ---- draft generation for valid categories ----

test.describe('@feature AINBOX-29 §7.10 draft generation', () => {
  test('generates draft for sales email and returns correct fields', async () => {
    const email = makeEmailRow({ category: 'sales' });
    const supabase = makeSupabase({});
    const deps = makeDeps({ generationScore: 0.8 });

    const result = await processDraftForEmail(email, supabase, deps);

    expect('skipped' in result).toBe(false);
    const r = result as WorkerResult;
    expect(r.draft_id).toBe('draft-edge-mock-001');
    // retrieval_score = max(0.88, 0.75) = 0.88; generation_score = 0.8
    // confidence = min(0.88, 0.8) = 0.8  (PRD §4.4)
    expect(r.retrieval_score).toBeCloseTo(0.88, 5);
    expect(r.generation_score).toBeCloseTo(0.8, 5);
    expect(r.confidence).toBeCloseTo(0.8, 5);
    expect(r.kb_items_used).toContain('kb-edge-1');
    expect(r.kb_items_used).toContain('kb-edge-2');
    expect(typeof r.provider_draft_id).toBe('string');
  });

  test('generates draft for support email', async () => {
    const email = makeEmailRow({ category: 'support' });
    const supabase = makeSupabase({});

    const result = await processDraftForEmail(email, supabase, makeDeps({}));

    expect('skipped' in result).toBe(false);
    expect((result as WorkerResult).draft_id).toBeTruthy();
  });

  test('confidence = min(retrieval, generation) not average', async () => {
    const email = makeEmailRow({ category: 'sales' });
    // retrieval_score = max(0.88, 0.75) = 0.88; generation_score = 0.5
    // confidence = min(0.88, 0.5) = 0.5
    const deps = makeDeps({ generationScore: 0.5 });
    const supabase = makeSupabase({});

    const result = await processDraftForEmail(email, supabase, deps) as WorkerResult;

    expect(result.confidence).toBeCloseTo(0.5, 5);
    // Confirm it is NOT the average
    const avg = (0.88 + 0.5) / 2;
    expect(result.confidence).not.toBeCloseTo(avg, 3);
  });
});

// ---- persistence: draft row ----

test.describe('@feature AINBOX-29 §7.10 draft persistence', () => {
  test('persists draft row with all required score fields', async () => {
    const email = makeEmailRow({ category: 'support' });
    const drafts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({ drafts });

    await processDraftForEmail(email, supabase, makeDeps({ generationScore: 0.7 }));

    expect(drafts).toHaveLength(1);
    const row = drafts[0];
    expect(row.user_id).toBe(email.user_id);
    expect(row.email_id).toBe(email.id);
    expect(row.status).toBe('pending');
    expect(typeof row.retrieval_score).toBe('number');
    expect(typeof row.generation_score).toBe('number');
    expect(typeof row.confidence).toBe('number');
    expect(Array.isArray(row.kb_items_used)).toBe(true);
    expect(typeof row.provider_draft_id).toBe('string');
    // body must be present but we do NOT log it in audit
    expect(typeof row.body).toBe('string');
  });

  test('draft row body is not stored in audit_log (PRD §6.1 / §9.3)', async () => {
    const email = makeEmailRow({ category: 'sales' });
    const auditLogs: Record<string, unknown>[] = [];
    const supabase = makeSupabase({ auditLogs });

    await processDraftForEmail(email, supabase, makeDeps({}));

    expect(auditLogs).toHaveLength(1);
    const audit = auditLogs[0];
    expect(audit.action).toBe('draft.created');
    expect(audit.user_id).toBe(email.user_id);
    expect(audit.email_id).toBe(email.id);
    expect(typeof audit.draft_id).toBe('string');
    // metadata must NOT contain email body
    const meta = audit.metadata as Record<string, unknown>;
    expect(meta).not.toHaveProperty('body');
    expect(meta.model).toBe('deepseek-v4-pro');
    expect(typeof meta.confidence).toBe('number');
    expect(typeof meta.retrieval_score).toBe('number');
    expect(typeof meta.generation_score).toBe('number');
  });

  test('throws on draft row insert failure', async () => {
    const email = makeEmailRow({ category: 'sales' });
    const supabase = makeSupabase({ insertFails: true });

    await expect(
      processDraftForEmail(email, supabase, makeDeps({})),
    ).rejects.toThrow(/persist failed/);
  });
});

// ---- provider draft ----

test.describe('@feature AINBOX-29 §7.10 provider draft', () => {
  test('calls createProviderDraftFn with the email provider', async () => {
    const email = makeEmailRow({ category: 'sales', provider: 'outlook' });
    const supabase = makeSupabase({});
    const providerCalls: { userId: string; provider: string }[] = [];

    const deps: WorkerDeps = {
      ...makeDeps({}),
      createProviderDraftFn: async (userId, provider, _body) => {
        providerCalls.push({ userId, provider });
        return {
          provider_draft_id: `test-${provider}-${userId.slice(0, 4)}`,
          provider,
          is_placeholder: true,
        };
      },
    };

    const result = await processDraftForEmail(email, supabase, deps) as WorkerResult;

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].provider).toBe('outlook');
    expect(providerCalls[0].userId).toBe(email.user_id);
    expect(result.provider_draft_id).toContain('outlook');
  });

  test('defaults to gmail when provider is null', async () => {
    const email = makeEmailRow({ category: 'sales', provider: null });
    const supabase = makeSupabase({});
    const providerCalls: { provider: string }[] = [];

    const deps: WorkerDeps = {
      ...makeDeps({}),
      createProviderDraftFn: async (userId, provider, _body) => {
        providerCalls.push({ provider });
        return {
          provider_draft_id: `test-${provider}`,
          provider,
          is_placeholder: true,
        };
      },
    };

    await processDraftForEmail(email, supabase, deps);

    expect(providerCalls[0].provider).toBe('gmail');
  });
});
