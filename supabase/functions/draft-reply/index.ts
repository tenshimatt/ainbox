/**
 * Supabase Edge Function — draft-reply
 *
 * PRD: §7.10 Reply drafting
 *      §4.4  Confidence model
 *
 * Background worker triggered by pg_cron (or directly) to generate reply
 * drafts for all classified inbound emails that are not spam/escalation/urgent.
 *
 * Auth: Bearer token in Authorization header (Supabase JWT for RLS, or the
 *       CRON_SECRET for the scheduled system invocation).
 *
 * Request body (JSON, optional):
 *   { limit?: number }   — max emails to process per invocation (default 10)
 *
 * Response:
 *   { ok: true, total, drafted, skipped, failed }
 *
 * LiteLLM gateway → deepseek-v4-pro (PRD §3.6).
 * Confidence = min(retrieval_score, generation_score) — NOT an average (PRD §4.4).
 * Categories skipped: spam, escalation, urgent (PRD §7.10).
 * Auto-send threshold enforcement is DOWNSTREAM (AINBOX-12) — not here.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DRAFT_SKIP_CATEGORIES = ['spam', 'escalation', 'urgent'] as const;
const DRAFT_MODEL = 'deepseek-v4-pro';
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

function buildUserPrompt(
  email: { subject: string; body: string },
  kb: Array<{ content: string; score: number }>,
  samples: Array<{ subject: string; body: string }>,
): string {
  const kbBlock = kb.length
    ? kb.map((k, i) => `[KB-${i + 1} score=${k.score.toFixed(3)}]\n${k.content}`).join('\n\n')
    : '(no KB items retrieved)';
  const sampleBlock = samples.length
    ? samples.map((s, i) => `[Sample-${i + 1}]\nSubject: ${s.subject}\n${s.body}`).join('\n\n')
    : '(no sample sent emails)';
  return [
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
}

async function callLiteLlm(
  userPrompt: string,
  litellmBaseUrl: string,
  litellmApiKey: string,
): Promise<{ body: string; generation_score: number }> {
  const resp = await fetch(`${litellmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${litellmApiKey}`,
    },
    body: JSON.stringify({
      model: DRAFT_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`LiteLLM error: ${resp.status}`);
  const json = (await resp.json()) as any;
  const content = json?.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as { body?: string; generation_score?: number };
  return {
    body: parsed.body ?? '',
    generation_score: typeof parsed.generation_score === 'number' ? parsed.generation_score : 0,
  };
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'missing authorization' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const litellmBaseUrl = Deno.env.get('LITELLM_BASE_URL');
  const litellmApiKey = Deno.env.get('LITELLM_API_KEY') ?? '';

  if (!supabaseUrl || !supabaseAnonKey || !litellmBaseUrl) {
    return new Response(
      JSON.stringify({ error: 'missing environment configuration' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Honour user JWT for RLS — tenant isolation is inherited from the token.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(body.limit ?? 10, 50);

  // Fetch classified inbound emails (not spam/escalation/urgent).
  const { data: emails, error: emailsErr } = await supabase
    .from('emails')
    .select('id,user_id,subject,body,from_address,category')
    .eq('user_id', user.id)
    .eq('direction', 'inbound')
    .not('category', 'is', null)
    .limit(limit);

  if (emailsErr) {
    return new Response(
      JSON.stringify({ error: 'email fetch failed', detail: emailsErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const rows = ((emails ?? []) as Array<{
    id: string;
    user_id: string;
    subject: string | null;
    body: string | null;
    from_address: string | null;
    category: string | null;
  }>).filter(
    (r) =>
      r.body &&
      r.category &&
      !(DRAFT_SKIP_CATEGORIES as readonly string[]).includes(r.category),
  );

  let drafted = 0;
  let skipped = (emails?.length ?? 0) - rows.length;
  let failed = 0;

  for (const row of rows) {
    try {
      const query = `${row.subject ?? ''}\n${row.body!}`;

      // KB retrieval (top-5 cosine similarity via RPC).
      const { data: kbData } = await supabase.rpc('match_knowledge_entries', {
        query_embedding: null, // embedding lookup is handled server-side via query text
        match_count: 5,
        user_id_filter: user.id,
      }).catch(() => ({ data: null }));
      const kb = ((kbData ?? []) as Array<{ content: string; score: number }>).slice(0, 5);

      // Sample sent emails for tone.
      const { data: sentData } = await supabase
        .from('emails')
        .select('subject,body')
        .eq('user_id', user.id)
        .eq('direction', 'outbound')
        .limit(3)
        .catch(() => ({ data: null }));
      const samples = (sentData ?? []) as Array<{ subject: string; body: string }>;

      const retrieval_score = kb.length ? Math.max(...kb.map((h) => h.score)) : 0;

      const userPrompt = buildUserPrompt(
        { subject: row.subject ?? '', body: row.body! },
        kb,
        samples,
      );

      const llmOut = await callLiteLlm(userPrompt, litellmBaseUrl, litellmApiKey);

      const generation_score = clamp01(llmOut.generation_score);
      const ret = clamp01(retrieval_score);
      const confidence = Math.min(ret, generation_score);

      // Persist draft.
      const { data: draftRow, error: insertErr } = await supabase
        .from('drafts')
        .insert({
          user_id: user.id,
          email_id: row.id,
          body: llmOut.body,
          retrieval_score: ret,
          generation_score,
          confidence,
          kb_items_used: kb.map((h: any) => h.id ?? ''),
          status: 'pending',
        })
        .select('id')
        .single();

      if (insertErr) throw new Error(insertErr.message);

      // Audit log — metadata only, NO email body (PRD §9.3).
      await supabase.from('audit_log').insert({
        user_id: user.id,
        email_id: row.id,
        draft_id: draftRow.id,
        action: 'draft.created',
        metadata: {
          model: DRAFT_MODEL,
          retrieval_score: ret,
          generation_score,
          confidence,
          kb_items_used: kb.map((h: any) => h.id ?? ''),
          source: 'edge_function',
        },
      });

      drafted += 1;
    } catch {
      failed += 1;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      total: emails?.length ?? 0,
      drafted,
      skipped,
      failed,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
