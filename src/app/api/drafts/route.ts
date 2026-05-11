/**
 * POST /api/drafts — generate + persist a reply draft.
 *
 * PRD: §4.4 Confidence model
 *      §7.10 Reply drafting
 *
 * Flow:
 *   1. Auth + load the inbound email row (RLS enforces tenant isolation).
 *   2. Run draftReply() — top-5 KB retrieval + LiteLLM call.
 *   3. Persist a row in `drafts` (including kb_items_used, scores).
 *   4. Create a draft at the provider via createProviderDraft().
 *   5. Append an `audit_log` row (no email body — metadata only).
 *
 * Auto-send threshold (≥0.85) is NOT enforced here — it lives in
 * AINBOX-12. This endpoint records the score and stores the draft.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  draftReply,
  liteLlmCall,
  type DraftDeps,
  type InboundEmail,
  type KbHit,
  type SampleSentEmail,
} from '@/lib/draft/draft';
import { createProviderDraft, type EmailProvider } from '@/lib/sync/draft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PostBody {
  email_id: string;
}

/**
 * GET /api/drafts — list pending drafts for the authenticated user, joined
 * with their source email (subject + category) so the UI can render
 * meaningful titles. Returns { drafts: Draft[] }.
 */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('drafts')
    .select('id, confidence, reply_body, status, created_at, updated_at, email_id, email_messages(subject, from_addr, category)')
    .eq('status', 'pending')
    .order('confidence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Joined = {
    id: string;
    confidence: number | null;
    reply_body: string | null;
    status: string | null;
    created_at: string;
    email_id: string | null;
    email_messages:
      | { subject: string | null; from_addr: string | null; category: string | null }
      | Array<{ subject: string | null; from_addr: string | null; category: string | null }>
      | null;
  };

  const drafts = (data as unknown as Joined[] ?? []).map((d) => {
    const em = Array.isArray(d.email_messages) ? d.email_messages[0] : d.email_messages;
    return {
      id: d.id,
      subject: em?.subject ?? '(no subject)',
      recipient: em?.from_addr ?? null,
      category: em?.category ?? null,
      confidence: d.confidence ?? 0,
      is_reply: true,
      body: d.reply_body,
      status: d.status,
      created_at: d.created_at,
    };
  });

  return NextResponse.json({ drafts });
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body?.email_id || typeof body.email_id !== 'string') {
    return NextResponse.json({ error: 'email_id required' }, { status: 400 });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: async () => (await cookies()).getAll(),
        setAll: () => {
          /* server route — no-op; auth handled upstream */
        },
      },
    },
  );

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Load email row — RLS scopes to this user.
  const { data: emailRow, error: emailErr } = await supabase
    .from('emails')
    .select('id, user_id, subject, body, from_address, category, provider')
    .eq('id', body.email_id)
    .single();
  if (emailErr || !emailRow) {
    return NextResponse.json({ error: 'email not found' }, { status: 404 });
  }

  const email: InboundEmail = {
    id: emailRow.id,
    user_id: emailRow.user_id,
    subject: emailRow.subject ?? '',
    body: emailRow.body ?? '',
    from: emailRow.from_address ?? undefined,
    category: emailRow.category ?? undefined,
  };

  const deps: DraftDeps = buildDeps(supabase);

  const draft = await draftReply(email, deps);

  // Persist draft row.
  const { data: draftRow, error: insertErr } = await supabase
    .from('drafts')
    .insert({
      user_id: user.id,
      email_id: email.id,
      body: draft.body,
      retrieval_score: draft.retrieval_score,
      generation_score: draft.generation_score,
      confidence: draft.confidence,
      kb_items_used: draft.kb_items_used,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertErr) {
    return NextResponse.json(
      { error: 'failed to persist draft', detail: insertErr.message },
      { status: 500 },
    );
  }

  // Provider draft (placeholder — AINBOX-5/6 will replace).
  const provider = (emailRow.provider as EmailProvider) ?? 'gmail';
  const providerDraft = await createProviderDraft(user.id, provider, draft.body);

  await supabase
    .from('drafts')
    .update({ provider_draft_id: providerDraft.provider_draft_id })
    .eq('id', draftRow.id);

  // Audit log — metadata only, NO body.
  await supabase.from('audit_log').insert({
    user_id: user.id,
    action: 'draft.created',
    email_id: email.id,
    draft_id: draftRow.id,
    metadata: {
      model: 'deepseek-v4-pro',
      retrieval_score: draft.retrieval_score,
      generation_score: draft.generation_score,
      confidence: draft.confidence,
      kb_items_used: draft.kb_items_used,
      provider,
      provider_draft_id: providerDraft.provider_draft_id,
    },
  });

  return NextResponse.json(
    {
      draft_id: draftRow.id,
      retrieval_score: draft.retrieval_score,
      generation_score: draft.generation_score,
      confidence: draft.confidence,
      kb_items_used: draft.kb_items_used,
      provider_draft_id: providerDraft.provider_draft_id,
    },
    { status: 201 },
  );
}

/**
 * Wire the dependency bundle for the worker. Exported in spirit
 * (test injects its own deps directly into draftReply); production
 * goes through this builder.
 */
function buildDeps(supabase: ReturnType<typeof createServerClient>): DraftDeps {
  return {
    searchKb: async (userId, query, topN) => {
      // Server-side call to AINBOX-7 KB embedding search.
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
      const resp = await fetch(
        `${baseUrl.replace(/\/$/, '')}/api/embeddings/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, query, top_n: topN }),
        },
      );
      if (!resp.ok) return [];
      const data = (await resp.json()) as { hits?: KbHit[] };
      return data.hits ?? [];
    },
    loadSampleSent: async (userId, n) => {
      const { data } = await supabase
        .from('emails')
        .select('subject, body')
        .eq('user_id', userId)
        .eq('direction', 'sent')
        .order('sent_at', { ascending: false })
        .limit(n);
      return ((data ?? []) as SampleSentEmail[]) ?? [];
    },
    callLlm: liteLlmCall,
  };
}
