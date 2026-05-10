/**
 * AINBOX-22 — Orchestration helper: generate a draft reply for a single email.
 *
 * PRD: §7.10 Reply drafting
 *
 * Fetches the inbound email, searches KB via pgvector RPC, loads sample
 * sent emails for tone, calls `draftReply`, persists the draft row, and
 * writes an audit log entry.
 *
 * Pure over its deps (supabase-like client + injectable callLlm / embedder).
 * Tests inject mock implementations without network calls.
 *
 * confidence = min(retrieval_score, generation_score)  // NOT average (§4.4)
 */

import { draftReply, liteLlmCall, type KbHit, type SampleSentEmail } from './draft';
import { embedChunks, toPgVector } from '../embeddings/embed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GenerateDraftSupabaseLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

export interface GenerateDraftOptions {
  /** Override LiteLLM caller — tests inject a mock. */
  callLlm?: typeof liteLlmCall;
  /** Override embedder — tests inject a mock 1024-dim vector provider. */
  embedder?: (chunks: string[]) => Promise<number[][]>;
  /** Override clock — tests inject a fixed timestamp. */
  now?: () => Date;
}

export interface GenerateDraftResult {
  draft_id: string;
  confidence: number;
  retrieval_score: number;
  generation_score: number;
  kb_items_used: string[];
  created_at: string;
}

interface EmailRow {
  id: string;
  user_id: string;
  subject: string | null;
  body_preview: string | null;
  sender: string | null;
  category: string | null;
}

/**
 * Generate and persist an AI draft reply for `emailId`.
 *
 * Throws on DB fetch failure, missing email, or draft persist failure.
 * Audit log failure is non-fatal (logged but swallowed).
 */
export async function generateDraftForEmail(
  supabase: GenerateDraftSupabaseLike,
  userId: string,
  emailId: string,
  opts: GenerateDraftOptions = {},
): Promise<GenerateDraftResult> {
  const callLlm = opts.callLlm ?? liteLlmCall;
  const embedder = opts.embedder ?? embedChunks;
  const now = opts.now ?? (() => new Date());

  // 1. Fetch the inbound email — RLS + explicit user_id check (defence-in-depth).
  const { data: row, error: fetchErr } = await supabase
    .from('email_messages')
    .select('id,subject,body_preview,sender,user_id,category')
    .eq('id', emailId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(
      `generateDraftForEmail: fetch failed: ${String(fetchErr?.message ?? fetchErr)}`,
    );
  }
  if (!row) {
    throw new Error('generateDraftForEmail: email not found');
  }

  const emailRow = row as EmailRow;

  // 2. Deps — KB search via pgvector RPC, sample sent emails for tone.
  const searchKb = async (uid: string, query: string, topN: number): Promise<KbHit[]> => {
    const vecs = await embedder([query]);
    const vec = vecs[0];
    if (!vec) return [];
    const { data, error } = await supabase.rpc('match_kb_items', {
      query_embedding: toPgVector(vec),
      match_count: topN,
    });
    if (error || !data) return [];
    return (data as { id: string; content: string; similarity: number }[]).map((r) => ({
      id: r.id,
      content: r.content,
      score: r.similarity,
    }));
  };

  const loadSampleSent = async (uid: string, n: number): Promise<SampleSentEmail[]> => {
    const { data } = await supabase
      .from('email_messages')
      .select('subject,body_preview')
      .eq('user_id', uid)
      .eq('direction', 'outbound')
      .order('received_at', { ascending: false })
      .limit(n);
    return ((data ?? []) as { subject: string | null; body_preview: string | null }[]).map(
      (r) => ({
        subject: r.subject ?? '',
        body: r.body_preview ?? '',
      }),
    );
  };

  const inbound = {
    id: emailRow.id,
    user_id: emailRow.user_id,
    subject: emailRow.subject ?? '',
    body: emailRow.body_preview ?? '',
    from: emailRow.sender ?? undefined,
    category: emailRow.category ?? undefined,
  };

  // 3. Generate draft via draftReply worker (PRD §7.10).
  const result = await draftReply(inbound, { searchKb, loadSampleSent, callLlm });

  const nowIso = now().toISOString();

  // 4. Persist draft row — status='pending', awaiting approval or auto-send (AINBOX-12).
  const { data: draft, error: insertErr } = await supabase
    .from('drafts')
    .insert({
      user_id: userId,
      in_reply_to: emailId,
      body: result.body,
      confidence: result.confidence,
      category: emailRow.category ?? null,
      status: 'pending',
      created_at: nowIso,
    })
    .select('id')
    .single();

  if (insertErr) {
    throw new Error(
      `generateDraftForEmail: persist failed: ${String(insertErr?.message ?? insertErr)}`,
    );
  }

  const draftId = (draft as { id: string }).id;

  // 5. Audit log — non-fatal; swallow errors so draft result is still returned.
  try {
    await supabase.from('audit_log').insert({
      user_id: userId,
      event_type: 'draft_generated',
      target_id: draftId,
      model: 'deepseek-v4-pro',
      confidence: result.confidence,
      kb_items_used: result.kb_items_used,
      details_json: {
        email_id: emailId,
        retrieval_score: result.retrieval_score,
        generation_score: result.generation_score,
      },
      created_at: nowIso,
    });
  } catch {
    // Audit log failure must not propagate — draft was already persisted.
  }

  return {
    draft_id: draftId,
    confidence: result.confidence,
    retrieval_score: result.retrieval_score,
    generation_score: result.generation_score,
    kb_items_used: result.kb_items_used,
    created_at: nowIso,
  };
}
