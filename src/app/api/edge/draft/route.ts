/**
 * POST /api/edge/draft
 * AINBOX-22 — Generate an AI draft reply for an email via LiteLLM.
 *
 * Body: { email_id: string }
 *
 * Flow:
 *  1. Authenticate user
 *  2. Fetch email_messages row
 *  3. Build DraftDeps:
 *     - searchKb      : embed query → match_kb_items RPC (cosine sim)
 *     - loadSampleSent: last N is_outbound=true emails for tone
 *     - callLlm       : liteLlmCall (DeepSeek V4 Pro via LiteLLM gateway)
 *  4. draftReply() → { body, confidence, retrieval_score, generation_score, kb_items_used }
 *  5. Insert drafts row (status='pending')
 *  6. createProviderDraft() → provider_draft_id (placeholder until AINBOX-5/6)
 *  7. Update draft row with provider_draft_id
 *  8. Insert audit_log row
 *  9. Return { ok, draft_id, confidence, body, retrieval_score, generation_score, kb_items_used }
 *
 * PRD: §7.10 Reply drafting, §4.4 Confidence model
 * AINBOX-22
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { draftReply, liteLlmCall, type DraftDeps } from '@/lib/draft/draft';
import { embedChunks } from '@/lib/embeddings/embed';
import { createProviderDraft, type EmailProvider } from '@/lib/sync/draft';

export const dynamic = 'force-dynamic';

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (
          toSet: { name: string; value: string; options?: Record<string, unknown> }[],
        ) => {
          for (const { name, value, options } of toSet) {
            try {
              cookieStore.set(name, value, options);
            } catch {
              /* read-only context, ignore */
            }
          }
        },
      },
    },
  );
}

export async function POST(req: Request) {
  try {
    const supabase = await getSupabase();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { email_id?: string };
    const emailId = body.email_id;
    if (!emailId || typeof emailId !== 'string') {
      return NextResponse.json({ error: 'missing_email_id' }, { status: 400 });
    }

    // Fetch the email — RLS scopes to the user, but we also check user_id.
    const { data: row, error: fetchErr } = await supabase
      .from('email_messages')
      .select('id,subject,body,from_address,provider,category,user_id')
      .eq('id', emailId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json(
        { error: 'fetch_failed', detail: fetchErr.message },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const deps: DraftDeps = {
      searchKb: async (userId, query, topN) => {
        const vecs = await embedChunks([query]);
        if (!vecs.length) return [];
        const { data: hits, error } = await supabase.rpc('match_kb_items', {
          query_embedding: vecs[0],
          match_count: topN,
        });
        if (error || !hits) return [];
        return (hits as Array<{ id: string; content: string; similarity: number }>).map(
          (h) => ({ id: h.id, content: h.content, score: h.similarity }),
        );
      },
      loadSampleSent: async (userId, n) => {
        const { data: sent } = await supabase
          .from('email_messages')
          .select('subject,body')
          .eq('user_id', userId)
          .eq('is_outbound', true)
          .limit(n);
        return (sent ?? []).map((s: { subject: string | null; body: string | null }) => ({
          subject: s.subject ?? '',
          body: s.body ?? '',
        }));
      },
      callLlm: liteLlmCall,
    };

    const email = {
      id: row.id as string,
      user_id: user.id,
      subject: (row.subject as string | null) ?? '',
      body: (row.body as string | null) ?? '',
      from: row.from_address as string | undefined,
      category: row.category as string | undefined,
    };

    const result = await draftReply(email, deps);

    // Persist draft row (status='pending' — auto-send handled downstream by AINBOX-12).
    const nowIso = new Date().toISOString();
    const { data: draft, error: insertErr } = await supabase
      .from('drafts')
      .insert({
        user_id: user.id,
        in_reply_to: emailId,
        body: result.body,
        confidence: result.confidence,
        category: (row.category as string | null) ?? null,
        status: 'pending',
        created_at: nowIso,
      })
      .select('id')
      .single();

    if (insertErr || !draft) {
      return NextResponse.json(
        { error: 'persist_failed', detail: insertErr?.message },
        { status: 500 },
      );
    }

    // Create provider draft placeholder (real send wired in AINBOX-5/6).
    const provider = ((row.provider as string | null) ?? 'gmail') as EmailProvider;
    const providerResult = await createProviderDraft(user.id, provider, result.body);

    // Store the provider draft id alongside the draft row.
    await supabase
      .from('drafts')
      .update({ provider_draft_id: providerResult.provider_draft_id })
      .eq('id', draft.id as string)
      .eq('user_id', user.id);

    // Append-only audit trail — no body content logged (PRD §4.3, §6.1).
    const { error: auditErr } = await supabase.from('audit_log').insert({
      user_id: user.id,
      event_type: 'draft_generated',
      target_id: draft.id,
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

    if (auditErr) {
      // Audit failure is logged but not fatal to the draft result.
      console.error('[draft] audit_log insert failed', auditErr.message);
    }

    return NextResponse.json({
      ok: true,
      draft_id: draft.id,
      confidence: result.confidence,
      body: result.body,
      retrieval_score: result.retrieval_score,
      generation_score: result.generation_score,
      kb_items_used: result.kb_items_used,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'draft_failed', detail: msg }, { status: 500 });
  }
}
