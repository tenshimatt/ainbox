/**
 * AINBOX-29 — §7.10 Reply drafting (edge function / batch worker)
 *
 * PRD: §7.10 Reply drafting
 *      §4.4  Confidence model
 *
 * Tests the `batchDraftPendingEmails()` worker used by both the Supabase
 * Edge Function (supabase/functions/draft-reply/) and the cron route
 * (/api/edge/draft).
 *
 * Covers:
 *   - Valid emails receive drafts (sales, support, etc.)
 *   - Spam, escalation, urgent emails are skipped (PRD §7.10)
 *   - Emails with no body are skipped gracefully
 *   - Draft rows and audit_log entries are persisted
 *   - DRAFT_SKIP_CATEGORIES constant is correctly defined
 *   - Batch result counts (total / drafted / skipped / failed) are accurate
 *   - Dependency injection works (mocked LLM + mocked KB)
 *
 * All fixtures are synthesised — no real email content (factory-rules §8).
 */

import { test, expect } from '@playwright/test';
import {
  batchDraftPendingEmails,
  DRAFT_SKIP_CATEGORIES,
  type BatchDraftResult,
  type MinimalSupabaseLike,
} from '../../src/lib/draft/batch';
import type { DraftDeps, KbHit } from '../../src/lib/draft/draft';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_KB: KbHit[] = [
  { id: 'kb-1', content: 'Widget A costs 10 fictional credits.', score: 0.88 },
  { id: 'kb-2', content: 'Returns accepted within 30 days.', score: 0.72 },
];

function makeDeps(generationScore = 0.75): DraftDeps {
  return {
    searchKb: async () => FIXTURE_KB,
    loadSampleSent: async () => [
      { subject: 'Re: synthetic thread', body: 'Thanks — confirmed.' },
      { subject: 'Re: other thread', body: 'Will follow up.' },
    ],
    callLlm: async () => ({
      body: 'Synthetic batch draft reply.',
      generation_score: generationScore,
    }),
  };
}

// ---------------------------------------------------------------------------
// Minimal fake Supabase — typed to MinimalSupabaseLike
// ---------------------------------------------------------------------------

interface FakeEmailRow {
  id: string;
  user_id: string;
  subject: string;
  body: string | null;
  from_address: string;
  category: string;
  provider: string;
  direction: string;
}

function makeSupabase(emailRows: FakeEmailRow[]): {
  supabase: MinimalSupabaseLike;
  insertedDrafts: Record<string, unknown>[];
  insertedAuditLogs: Record<string, unknown>[];
} {
  const insertedDrafts: Record<string, unknown>[] = [];
  const insertedAuditLogs: Record<string, unknown>[] = [];

  let draftSeq = 0;

  const supabase: MinimalSupabaseLike = {
    from(table: string) {
      if (table === 'emails') {
        return {
          select(_cols: string) {
            const chain = {
              eq(_col: string, _val: unknown) {
                return chain;
              },
              not(_col: string, _op: string, _val: unknown) {
                return chain;
              },
              async limit(_n: number) {
                return { data: emailRows as unknown[], error: null };
              },
            };
            return chain;
          },
          async insert(_row: Record<string, unknown>) {
            return { data: null, error: null };
          },
        };
      }

      if (table === 'drafts') {
        return {
          select(_cols: string) {
            const chain = {
              eq(_col: string, _val: unknown) { return chain; },
              not(_col: string, _op: string, _val: unknown) { return chain; },
              async limit(_n: number) { return { data: [], error: null }; },
            };
            return chain;
          },
          async insert(row: Record<string, unknown>) {
            draftSeq += 1;
            const id = `draft-${draftSeq}`;
            insertedDrafts.push({ id, ...row });
            return { data: [{ id }], error: null };
          },
        };
      }

      if (table === 'audit_log') {
        return {
          select(_cols: string) {
            const chain = {
              eq(_col: string, _val: unknown) { return chain; },
              not(_col: string, _op: string, _val: unknown) { return chain; },
              async limit(_n: number) { return { data: [], error: null }; },
            };
            return chain;
          },
          async insert(row: Record<string, unknown>) {
            insertedAuditLogs.push(row);
            return { data: [{}], error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, insertedDrafts, insertedAuditLogs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-29 §7.10 batch reply drafting', () => {
  test('DRAFT_SKIP_CATEGORIES contains spam, escalation, urgent', () => {
    expect(DRAFT_SKIP_CATEGORIES).toContain('spam');
    expect(DRAFT_SKIP_CATEGORIES).toContain('escalation');
    expect(DRAFT_SKIP_CATEGORIES).toContain('urgent');
    expect(DRAFT_SKIP_CATEGORIES).toHaveLength(3);
  });

  test('drafts valid emails (sales, support)', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-sales-1',
        user_id: 'u1',
        subject: 'Synthetic sales enquiry',
        body: 'Interested in your widget pricing for 50 units.',
        from_address: 'buyer@ainbox.test',
        category: 'sales',
        provider: 'gmail',
        direction: 'inbound',
      },
      {
        id: 'e-support-1',
        user_id: 'u1',
        subject: 'Synthetic support request',
        body: 'Cannot log in to my account.',
        from_address: 'user@ainbox.test',
        category: 'support',
        provider: 'gmail',
        direction: 'inbound',
      },
    ];

    const { supabase, insertedDrafts, insertedAuditLogs } = makeSupabase(emails);
    const result: BatchDraftResult = await batchDraftPendingEmails(
      supabase,
      'u1',
      10,
      { deps: makeDeps(0.75) },
    );

    expect(result.total).toBe(2);
    expect(result.drafted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(insertedDrafts).toHaveLength(2);
    expect(insertedAuditLogs).toHaveLength(2);
  });

  test('skips spam emails', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-spam-1',
        user_id: 'u1',
        subject: 'Synthetic spam email',
        body: 'Win a free prize!',
        from_address: 'spammer@ainbox.test',
        category: 'spam',
        provider: 'gmail',
        direction: 'inbound',
      },
    ];

    const { supabase, insertedDrafts } = makeSupabase(emails);
    const result = await batchDraftPendingEmails(supabase, 'u1', 10, {
      deps: makeDeps(),
    });

    expect(result.total).toBe(1);
    expect(result.drafted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(insertedDrafts).toHaveLength(0);
  });

  test('skips escalation emails', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-esc-1',
        user_id: 'u1',
        subject: 'Synthetic escalation',
        body: 'This is an escalation.',
        from_address: 'exec@ainbox.test',
        category: 'escalation',
        provider: 'gmail',
        direction: 'inbound',
      },
    ];

    const { supabase, insertedDrafts } = makeSupabase(emails);
    const result = await batchDraftPendingEmails(supabase, 'u1', 10, {
      deps: makeDeps(),
    });

    expect(result.skipped).toBe(1);
    expect(result.drafted).toBe(0);
    expect(insertedDrafts).toHaveLength(0);
  });

  test('skips urgent emails', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-urgent-1',
        user_id: 'u1',
        subject: 'URGENT: Synthetic issue',
        body: 'This needs immediate attention.',
        from_address: 'vip@ainbox.test',
        category: 'urgent',
        provider: 'gmail',
        direction: 'inbound',
      },
    ];

    const { supabase, insertedDrafts } = makeSupabase(emails);
    const result = await batchDraftPendingEmails(supabase, 'u1', 10, {
      deps: makeDeps(),
    });

    expect(result.skipped).toBe(1);
    expect(result.drafted).toBe(0);
    expect(insertedDrafts).toHaveLength(0);
  });

  test('mixed batch: valid + skip categories produces correct counts', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-sales-2',
        user_id: 'u1',
        subject: 'Synthetic sales',
        body: 'Quote request.',
        from_address: 'a@ainbox.test',
        category: 'sales',
        provider: 'gmail',
        direction: 'inbound',
      },
      {
        id: 'e-spam-2',
        user_id: 'u1',
        subject: 'Synthetic spam',
        body: 'Buy now!',
        from_address: 'b@ainbox.test',
        category: 'spam',
        provider: 'gmail',
        direction: 'inbound',
      },
      {
        id: 'e-support-2',
        user_id: 'u1',
        subject: 'Synthetic support',
        body: 'Need help.',
        from_address: 'c@ainbox.test',
        category: 'support',
        provider: 'gmail',
        direction: 'inbound',
      },
      {
        id: 'e-urgent-2',
        user_id: 'u1',
        subject: 'Urgent matter',
        body: 'Emergency.',
        from_address: 'd@ainbox.test',
        category: 'urgent',
        provider: 'gmail',
        direction: 'inbound',
      },
    ];

    const { supabase, insertedDrafts } = makeSupabase(emails);
    const result = await batchDraftPendingEmails(supabase, 'u1', 10, {
      deps: makeDeps(0.8),
    });

    expect(result.total).toBe(4);
    expect(result.drafted).toBe(2); // sales + support
    expect(result.skipped).toBe(2); // spam + urgent
    expect(result.failed).toBe(0);
    expect(insertedDrafts).toHaveLength(2);
  });

  test('skips email with null body without failing', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-nobody-1',
        user_id: 'u1',
        subject: 'Synthetic email',
        body: null,
        from_address: 'x@ainbox.test',
        category: 'support',
        provider: 'gmail',
        direction: 'inbound',
      },
    ];

    const { supabase } = makeSupabase(emails);
    const result = await batchDraftPendingEmails(supabase, 'u1', 10, {
      deps: makeDeps(),
    });

    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
  });

  test('confidence = min(retrieval_score, generation_score) in batch', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-inv-1',
        user_id: 'u1',
        subject: 'Synthetic invoice',
        body: 'Please find attached invoice #123.',
        from_address: 'billing@ainbox.test',
        category: 'invoice',
        provider: 'gmail',
        direction: 'inbound',
      },
    ];

    const { supabase, insertedDrafts } = makeSupabase(emails);

    // KB score = 0.88 (from FIXTURE_KB); generation_score = 0.60
    // Expected confidence = min(0.88, 0.60) = 0.60
    await batchDraftPendingEmails(supabase, 'u1', 10, {
      deps: makeDeps(0.6),
    });

    expect(insertedDrafts).toHaveLength(1);
    const draft = insertedDrafts[0];
    expect(draft.confidence as number).toBeCloseTo(0.6, 5);
    expect(draft.retrieval_score as number).toBeCloseTo(0.88, 5);
    expect(draft.generation_score as number).toBeCloseTo(0.6, 5);
  });

  test('draft row has required fields (status=pending, user_id, email_id)', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-meeting-1',
        user_id: 'u-batch-test',
        subject: 'Synthetic meeting request',
        body: 'Can we schedule a call next week?',
        from_address: 'partner@ainbox.test',
        category: 'meeting',
        provider: 'outlook',
        direction: 'inbound',
      },
    ];

    const { supabase, insertedDrafts } = makeSupabase(emails);
    await batchDraftPendingEmails(supabase, 'u-batch-test', 10, {
      deps: makeDeps(0.85),
    });

    expect(insertedDrafts).toHaveLength(1);
    const d = insertedDrafts[0];
    expect(d.user_id).toBe('u-batch-test');
    expect(d.email_id).toBe('e-meeting-1');
    expect(d.status).toBe('pending');
    expect(typeof d.body).toBe('string');
    expect((d.body as string).length).toBeGreaterThan(0);
  });

  test('audit_log entry has action=draft.created and no email body', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-complaint-1',
        user_id: 'u1',
        subject: 'Synthetic complaint',
        body: 'I am unhappy with the service.',
        from_address: 'unhappy@ainbox.test',
        category: 'complaint',
        provider: 'gmail',
        direction: 'inbound',
      },
    ];

    const { supabase, insertedAuditLogs } = makeSupabase(emails);
    await batchDraftPendingEmails(supabase, 'u1', 10, { deps: makeDeps() });

    expect(insertedAuditLogs).toHaveLength(1);
    const log = insertedAuditLogs[0];
    expect(log.action).toBe('draft.created');
    expect(log.user_id).toBe('u1');
    expect(log.email_id).toBe('e-complaint-1');
    // Body must NOT appear in the audit log (PRD §9.3).
    expect(JSON.stringify(log)).not.toContain('unhappy with the service');
    // Metadata should include model and scores.
    const meta = log.metadata as Record<string, unknown>;
    expect(meta.model).toBe('deepseek-v4-pro');
    expect(typeof meta.confidence).toBe('number');
    expect(meta.source).toBe('batch');
  });

  test('returns empty result when no emails found', async () => {
    const { supabase } = makeSupabase([]);
    const result = await batchDraftPendingEmails(supabase, 'u1', 10, {
      deps: makeDeps(),
    });

    expect(result.total).toBe(0);
    expect(result.drafted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  test('result.results contains ok:true entries with draft_id and confidence', async () => {
    const emails: FakeEmailRow[] = [
      {
        id: 'e-other-1',
        user_id: 'u1',
        subject: 'Synthetic enquiry',
        body: 'General question about your product.',
        from_address: 'user@ainbox.test',
        category: 'other',
        provider: 'gmail',
        direction: 'inbound',
      },
    ];

    const { supabase } = makeSupabase(emails);
    const result = await batchDraftPendingEmails(supabase, 'u1', 10, {
      deps: makeDeps(0.7),
    });

    expect(result.results).toHaveLength(1);
    const entry = result.results[0];
    expect(entry.ok).toBe(true);
    if (entry.ok) {
      expect(entry.email_id).toBe('e-other-1');
      expect(typeof entry.draft_id).toBe('string');
      expect(typeof entry.confidence).toBe('number');
    }
  });
});
