/**
 * Background worker helpers for reply drafting — AINBOX-29.
 * PRD: §7.10 Reply drafting (edge function)
 *
 * Extracts testable business logic from the edge/draft route so it can
 * be covered by Playwright unit specs without hitting the HTTP layer.
 *
 * confidence = min(retrieval_score, generation_score)  — PRD §4.4, NOT average
 */

import {
  draftReply,
  liteLlmCall,
  type DraftDeps,
  type InboundEmail,
} from './draft';
import { createProviderDraft, type EmailProvider } from '../sync/draft';

/**
 * PRD §7.10 — these categories must never receive an auto-draft.
 * "For every classified email (except spam/escalation/urgent)"
 */
export const SKIP_CATEGORIES = ['spam', 'escalation', 'urgent'] as const;
export type SkipCategory = (typeof SKIP_CATEGORIES)[number];

/** Return true if the category should be skipped (no draft generated). */
export function shouldSkipCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return (SKIP_CATEGORIES as readonly string[]).includes(category);
}

export interface WorkerEmailRow {
  id: string;
  user_id: string;
  subject: string | null;
  body: string | null;
  from_address: string | null;
  category: string | null;
  provider: string | null;
}

export interface WorkerResult {
  draft_id: string;
  retrieval_score: number;
  generation_score: number;
  confidence: number;
  kb_items_used: string[];
  provider_draft_id: string;
}

export interface WorkerSkipped {
  skipped: true;
  skip_reason: string;
}

/**
 * Minimal Supabase-compatible interface required by the worker.
 * Using `any` return for `from()` because different tables need
 * different chainable shapes (insert→select→single vs insert→await).
 */
export interface WorkerSupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface WorkerDeps extends DraftDeps {
  /** Injected for testing. Defaults to the real createProviderDraft. */
  createProviderDraftFn?: typeof createProviderDraft;
}

/**
 * Build production deps for the worker from a Supabase client.
 * Tests inject their own deps directly into processDraftForEmail.
 */
export function buildWorkerDeps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  appUrl: string,
): WorkerDeps {
  return {
    searchKb: async (userId, query, topN) => {
      const resp = await fetch(`${appUrl.replace(/\/$/, '')}/api/embeddings/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, query, top_n: topN }),
      });
      if (!resp.ok) return [];
      const data = (await resp.json()) as { hits?: { id: string; content: string; score: number }[] };
      return data.hits ?? [];
    },
    loadSampleSent: async (userId, n) => {
      const { data } = await supabase
        .from('email_messages')
        .select('subject, body')
        .eq('user_id', userId)
        .eq('direction', 'sent')
        .order('sent_at', { ascending: false })
        .limit(n);
      return (data ?? []) as { subject: string; body: string }[];
    },
    callLlm: liteLlmCall,
  };
}

/**
 * Generate and persist a draft for a single classified email.
 *
 * Returns `{ skipped: true }` for spam / escalation / urgent without
 * touching the database (PRD §7.10).
 *
 * Pure over `deps` and `supabase` — tests inject stubs; the edge route
 * passes real implementations.
 *
 * Audit log entry: metadata only — NO email body logged (PRD §6.1, §9.3).
 */
export async function processDraftForEmail(
  email: WorkerEmailRow,
  supabase: WorkerSupabaseLike,
  deps: WorkerDeps,
): Promise<WorkerResult | WorkerSkipped> {
  if (shouldSkipCategory(email.category)) {
    return { skipped: true, skip_reason: `category=${email.category}` };
  }

  const inbound: InboundEmail = {
    id: email.id,
    user_id: email.user_id,
    subject: email.subject ?? '',
    body: email.body ?? '',
    from: email.from_address ?? undefined,
    category: email.category ?? undefined,
  };

  const draftResult = await draftReply(inbound, deps);

  const draftProviderFn = deps.createProviderDraftFn ?? createProviderDraft;
  const provider = (email.provider as EmailProvider) ?? 'gmail';
  const providerDraft = await draftProviderFn(email.user_id, provider, draftResult.body);

  // Persist draft row — include provider_draft_id at insert time.
  const insertResult = await supabase
    .from('drafts')
    .insert({
      user_id: email.user_id,
      email_id: email.id,
      body: draftResult.body,
      retrieval_score: draftResult.retrieval_score,
      generation_score: draftResult.generation_score,
      confidence: draftResult.confidence,
      kb_items_used: draftResult.kb_items_used,
      status: 'pending',
      provider_draft_id: providerDraft.provider_draft_id,
    })
    .select('id')
    .single();

  if (insertResult.error || !insertResult.data?.id) {
    throw new Error(
      `processDraftForEmail: persist failed: ${insertResult.error?.message ?? 'no id returned'}`,
    );
  }

  const draftId = String(insertResult.data.id);

  // Audit log — metadata only, NO body (PRD §6.1).
  await supabase.from('audit_log').insert({
    user_id: email.user_id,
    action: 'draft.created',
    email_id: email.id,
    draft_id: draftId,
    metadata: {
      model: 'deepseek-v4-pro',
      retrieval_score: draftResult.retrieval_score,
      generation_score: draftResult.generation_score,
      confidence: draftResult.confidence,
      kb_items_used: draftResult.kb_items_used,
      provider,
      provider_draft_id: providerDraft.provider_draft_id,
    },
  });

  return {
    draft_id: draftId,
    retrieval_score: draftResult.retrieval_score,
    generation_score: draftResult.generation_score,
    confidence: draftResult.confidence,
    kb_items_used: draftResult.kb_items_used,
    provider_draft_id: providerDraft.provider_draft_id,
  };
}
