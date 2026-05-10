/**
 * Supabase Edge Function: draft
 *
 * AINBOX-29: §7.10 Reply drafting (edge function).
 *
 * PRD: §7.10 Reply drafting
 *      §4.4  Confidence model
 *
 * Triggered by pg_cron or Supabase Realtime on inbound email arrival.
 * Accepts POST { email_id } with a valid Supabase JWT and runs the full
 * reply-drafting pipeline:
 *   1. Top-5 KB retrieval (LiteLLM → Ollama bge-m3 embeddings + pgvector).
 *   2. 3 sample sent-emails for tone-priming.
 *   3. DeepSeek V4 Pro via LiteLLM for structured-output reply.
 *   4. Confidence = MIN(retrieval_score, generation_score) — NOT average.
 *   5. Persist draft row + provider-side draft.
 *   6. Append audit_log (metadata only — no body content).
 *
 * Deno entry point — see ./handler.ts for the pure, testable HTTP handler.
 */

// @deno-types="npm:@supabase/supabase-js@^2"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleDraftRequest, type HandlerDeps, type DraftResult } from './handler.ts';

const LITELLM_BASE_URL =
  Deno.env.get('LITELLM_BASE_URL') ?? 'https://ai-gateway.beyondpandora.com/v1';
const LITELLM_API_KEY = Deno.env.get('LITELLM_API_KEY') ?? '';
const LITELLM_EMBEDDING_MODEL =
  Deno.env.get('LITELLM_EMBEDDING_MODEL') ?? 'bge-m3';
const DRAFT_MODEL = 'deepseek-v4-pro';

// ---- LiteLLM helpers ----------------------------------------------------

async function embedText(text: string): Promise<number[]> {
  const url = `${LITELLM_BASE_URL.replace(/\/$/, '')}/embeddings`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LITELLM_API_KEY}`,
    },
    body: JSON.stringify({ model: LITELLM_EMBEDDING_MODEL, input: [text] }),
  });
  if (!resp.ok) throw new Error(`embedText: LiteLLM HTTP ${resp.status}`);
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  const vec = json.data?.[0]?.embedding;
  if (!vec || vec.length !== 1024) {
    throw new Error(`embedText: unexpected dimension ${vec?.length ?? 'none'}`);
  }
  return vec;
}

async function callLlm(
  system: string,
  user: string,
): Promise<{ body: string; generation_score: number }> {
  const url = `${LITELLM_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LITELLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: DRAFT_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`callLlm: LiteLLM HTTP ${resp.status}`);
  const json = (await resp.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as {
    body?: string;
    generation_score?: number;
  };
  return {
    body: parsed.body ?? '',
    generation_score:
      typeof parsed.generation_score === 'number' ? parsed.generation_score : 0,
  };
}

// ---- Draft worker (inlined — cannot import from ../../src/) -------------

const SYSTEM_PROMPT = `You are an email reply assistant. Use the provided
knowledge-base snippets as the source of truth. Match the tone of the
sample sent emails. Reply concisely. Never invent facts not in the KB.

Output JSON ONLY in the shape:
{ "body": string, "generation_score": number }

generation_score is YOUR self-rated confidence in [0,1] that the reply
is correct, on-tone, and answers the email. Be honest; under-rate when
the KB does not cover the question.`;

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

async function runDraft(
  email: {
    id: string;
    user_id: string;
    subject: string;
    body: string;
    from?: string;
    category?: string;
  },
  supabase: ReturnType<typeof createClient>,
): Promise<DraftResult> {
  const query = `${email.subject}\n${email.body}`;

  // Embed the query for KB retrieval.
  const queryVec = await embedText(query);

  // Top-5 KB items via pgvector cosine similarity (match_kb_items RPC — §7.8).
  const { data: kbRows } = (await supabase.rpc('match_kb_items', {
    query_embedding: queryVec,
    match_count: 5,
  })) as { data: Array<{ id: string; content: string; similarity: number }> | null };

  const kbHits = (kbRows ?? []).map((r) => ({
    id: r.id,
    content: r.content,
    score: r.similarity,
  }));

  // 3 sample sent emails for tone-priming (PRD §7.10).
  const { data: sentRows } = await supabase
    .from('emails')
    .select('subject, body')
    .eq('user_id', email.user_id)
    .eq('direction', 'sent')
    .order('sent_at', { ascending: false })
    .limit(3);

  const samples = (sentRows ?? []) as Array<{ subject: string; body: string }>;

  // Build prompt.
  const kbBlock = kbHits.length
    ? kbHits.map((k, i) => `[KB-${i + 1} score=${k.score.toFixed(3)}]\n${k.content}`).join('\n\n')
    : '(no KB items retrieved)';
  const sampleBlock = samples.length
    ? samples.map((s, i) => `[Sample-${i + 1}]\nSubject: ${s.subject}\n${s.body}`).join('\n\n')
    : '(no sample sent emails)';
  const userPrompt = [
    '## Knowledge base (top-5 by cosine similarity)',
    kbBlock,
    '',
    '## Tone samples (recent sent emails)',
    sampleBlock,
    '',
    '## Inbound email to reply to',
    `Subject: ${email.subject}`,
    email.body,
  ].join('\n');

  const llmOut = await callLlm(SYSTEM_PROMPT, userPrompt);

  // Confidence = MIN(retrieval_score, generation_score) — PRD §4.4.
  const retrieval_score = kbHits.length
    ? clamp01(Math.max(...kbHits.map((h) => h.score)))
    : 0;
  const generation_score = clamp01(llmOut.generation_score);
  const confidence = Math.min(retrieval_score, generation_score);

  return {
    body: llmOut.body,
    retrieval_score,
    generation_score,
    confidence,
    kb_items_used: kbHits.map((h) => h.id),
  };
}

// ---- Deno.serve entry point ---------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const appUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3001';

  // Extract JWT once — used for both getUser and creating the per-user client.
  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  // Per-request Supabase client (carries the user JWT so RLS applies).
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const deps: HandlerDeps = {
    getUser: async (token) => {
      const { data: { user }, error } = await createClient(supabaseUrl, supabaseAnonKey).auth.getUser(token);
      if (error || !user) return null;
      return { id: user.id };
    },

    getEmail: async (userId, emailId) => {
      const { data } = await supabase
        .from('emails')
        .select('id, user_id, subject, body, from_address, category, provider')
        .eq('id', emailId)
        .eq('user_id', userId)
        .single();
      return data ?? null;
    },

    draftFn: (email) => runDraft(email, supabase),

    insertDraft: async (row) => {
      const { data, error } = await supabase
        .from('drafts')
        .insert(row)
        .select('id')
        .single();
      if (error || !data) throw new Error(`insertDraft failed: ${error?.message}`);
      return { id: data.id as string };
    },

    updateDraftProvider: async (draftId, providerDraftId) => {
      await supabase
        .from('drafts')
        .update({ provider_draft_id: providerDraftId })
        .eq('id', draftId);
    },

    createProviderDraft: async (userId, provider, body) => {
      // Placeholder — AINBOX-5/6 will replace with real Gmail/MS Graph call.
      const fakeId = `placeholder-${provider}-${userId.slice(0, 8)}-${body.length}`;
      return { provider_draft_id: fakeId, is_placeholder: true };
    },

    logAudit: async (entry) => {
      await supabase.from('audit_log').insert({
        user_id: entry.user_id,
        action: entry.action,
        email_id: entry.email_id,
        draft_id: entry.draft_id,
        metadata: entry.metadata,
      });
    },
  };

  return handleDraftRequest(req, deps);
});
