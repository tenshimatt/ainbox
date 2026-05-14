/**
 * POST /api/edge/draft
 * TASKRESPONSE-22 — Generate an AI draft reply via LiteLLM for the authenticated user.
 *
 * PRD: §7.10 Reply drafting
 *
 * Body: { email_id: string }
 *
 * 1. Auth via session cookie (RLS-scoped Supabase client).
 * 2. Delegates to generateDraftForEmail() which fetches the email, searches KB,
 *    calls LiteLLM (deepseek-v4-pro), persists the draft, and writes audit_log.
 * 3. Returns { ok, draft_id, confidence, retrieval_score, generation_score,
 *              kb_items_used, created_at }.
 *
 * Thresholding (auto-send ≥ 0.85) is enforced downstream by TASKRESPONSE-12.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { generateDraftForEmail } from '@/lib/draft/generate';

export const dynamic = 'force-dynamic';

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
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

    const result = await generateDraftForEmail(supabase, user.id, emailId);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.includes('not found')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'draft_failed', detail: msg }, { status: 500 });
  }
}
