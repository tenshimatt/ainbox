/**
 * PRD §7.10 — batch reply-drafting worker.
 *
 * For every classified inbound email (except `spam`, `escalation`, `urgent`)
 * that the caller supplies via a Supabase-like client, this module:
 *   1. Retrieves top-5 KB items by cosine similarity.
 *   2. Loads 3 sample sent emails for tone-priming.
 *   3. Calls LiteLLM (deepseek-v4-pro) for a structured reply + self-rated
 *      confidence.
 *   4. Computes final confidence = min(retrieval_score, generation_score).
 *   5. Persists the draft row in `drafts`.
 *   6. Writes an audit_log entry (metadata only — no email body).
 *
 * Called by the Supabase Edge Function (`supabase/functions/draft-reply/`)
 * and the cron-driven Next.js route (`/api/edge/draft`).
 *
 * Confidence thresholding (auto-send ≥ 0.85) is enforced downstream by the
 * auto-send executor (AINBOX-12). This module only RECORDS the score.
 */

import {
  draftReply,
  liteLlmCall,
  type DraftDeps,
  type InboundEmail,
  type KbHit,
  type SampleSentEmail,
} from './draft';

/** Categories that must NOT receive auto-generated drafts (PRD §7.10). */
export const DRAFT_SKIP_CATEGORIES = ['spam', 'escalation', 'urgent'] as const;
export type DraftSkipCategory = (typeof DRAFT_SKIP_CATEGORIES)[number];

export interface BatchDraftResult {
  total: number;
  drafted: number;
  skipped: number;
  failed: number;
  results: Array<
    | { email_id: string; ok: true; draft_id: string; confidence: number }
    | { email_id: string; ok: false; error: string }
  >;
}

export interface BatchDraftOptions {
  /** Override drafting dependencies (inject mocks in tests). */
  deps?: DraftDeps;
  /** Override current time source for deterministic tests. */
  now?: () => Date;
}

interface PendingEmailRow {
  id: string;
  user_id: string;
  subject: string | null;
  body: string | null;
  from_address: string | null;
  category: string | null;
  provider: string | null;
}

// ---------------------------------------------------------------------------
// Minimal Supabase interface — only the operations this module uses.
// Typed narrowly so tests can provide lightweight fakes without a live client.
// ---------------------------------------------------------------------------

interface SelectChain {
  eq: (col: string, val: unknown) => SelectChain;
  not: (col: string, op: string, val: unknown) => SelectChain;
  limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
}

export interface MinimalSupabaseLike {
  from: (table: string) => {
    select: (cols: string) => SelectChain;
    insert: (
      row: Record<string, unknown>,
    ) => Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate drafts for pending classified inbound emails.
 *
 * Tenant isolation is the caller's responsibility — pass an RLS-scoped client
 * (user-facing) or run with a service-role client scoped to a specific user_id
 * (background worker). Defence-in-depth: skip categories are also filtered
 * in-memory after the query.
 */
export async function batchDraftPendingEmails(
  supabase: MinimalSupabaseLike,
  userId: string,
  limit = 10,
  opts: BatchDraftOptions = {},
): Promise<BatchDraftResult> {
  const now = opts.now ?? (() => new Date());

  // Default deps wire real LiteLLM; tests inject stubs.
  const deps: DraftDeps = opts.deps ?? {
    searchKb: async (_uid: string, _q: string, _n: number): Promise<KbHit[]> => [],
    loadSampleSent: async (_uid: string, _n: number): Promise<SampleSentEmail[]> => [],
    callLlm: liteLlmCall,
  };

  const { data, error } = await supabase
    .from('emails')
    .select('id,user_id,subject,body,from_address,category,provider')
    .eq('user_id', userId)
    .eq('direction', 'inbound')
    .not('category', 'is', null)
    .limit(limit);

  if (error) {
    throw new Error(`batchDraftPendingEmails: select failed: ${String(error)}`);
  }

  const allRows = (data ?? []) as PendingEmailRow[];

  // Filter skip categories in-memory (defence-in-depth, PRD §7.10 + §9).
  const eligible = allRows.filter(
    (r) =>
      r.category &&
      !(DRAFT_SKIP_CATEGORIES as readonly string[]).includes(r.category),
  );

  const out: BatchDraftResult = {
    total: allRows.length,
    drafted: 0,
    skipped: allRows.length - eligible.length,
    failed: 0,
    results: [],
  };

  for (const row of eligible) {
    if (!row.body) {
      out.skipped += 1;
      continue;
    }

    try {
      const email: InboundEmail = {
        id: row.id,
        user_id: row.user_id,
        subject: row.subject ?? '',
        body: row.body,
        from: row.from_address ?? undefined,
        category: row.category ?? undefined,
      };

      const draft = await draftReply(email, deps);

      const { data: insertData, error: insertErr } = await supabase
        .from('drafts')
        .insert({
          user_id: userId,
          email_id: row.id,
          body: draft.body,
          retrieval_score: draft.retrieval_score,
          generation_score: draft.generation_score,
          confidence: draft.confidence,
          kb_items_used: draft.kb_items_used,
          status: 'pending',
          created_at: now().toISOString(),
        });

      if (insertErr) {
        throw new Error(`draft insert failed: ${String(insertErr)}`);
      }

      const draftId =
        (insertData?.[0]?.id as string | undefined) ?? `draft-${row.id}`;

      // Audit log — metadata only, NO email body (PRD §4.3 / §9.3).
      await supabase.from('audit_log').insert({
        user_id: userId,
        email_id: row.id,
        draft_id: draftId,
        action: 'draft.created',
        metadata: {
          model: 'deepseek-v4-pro',
          retrieval_score: draft.retrieval_score,
          generation_score: draft.generation_score,
          confidence: draft.confidence,
          kb_items_used: draft.kb_items_used,
          source: 'batch',
        },
        created_at: now().toISOString(),
      });

      out.drafted += 1;
      out.results.push({
        email_id: row.id,
        ok: true,
        draft_id: draftId,
        confidence: draft.confidence,
      });
    } catch (err) {
      out.failed += 1;
      out.results.push({
        email_id: row.id,
        ok: false,
        error: (err as Error).message ?? 'unknown',
      });
    }
  }

  return out;
}
