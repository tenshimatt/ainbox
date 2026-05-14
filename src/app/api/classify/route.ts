/**
 * POST /api/classify
 * TASKRESPONSE-9 — Classify a single email by id for the authenticated user.
 * Updates `email_messages.category` + `classified_at`, writes audit_log row.
 * PRD: §7.9
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { classifyEmail } from '@/lib/classify/classify';

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

    // Fetch the email — RLS scopes to the user, but we also check user_id.
    const { data: row, error: fetchErr } = await supabase
      .from('email_messages')
      .select('id,subject,body,from_address,user_id')
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

    const result = await classifyEmail({
      id: row.id,
      subject: row.subject,
      body: row.body,
      from: row.from_address,
    });

    const nowIso = new Date().toISOString();

    const { error: updErr } = await supabase
      .from('email_messages')
      .update({ category: result.category, classified_at: nowIso })
      .eq('id', emailId)
      .eq('user_id', user.id);

    if (updErr) {
      return NextResponse.json(
        { error: 'persist_failed', detail: updErr.message },
        { status: 500 },
      );
    }

    const { error: auditErr } = await supabase.from('audit_log').insert({
      user_id: user.id,
      email_id: emailId,
      action: 'classify',
      category: result.category,
      confidence: result.confidence,
      created_at: nowIso,
    });

    if (auditErr) {
      // Audit failure is logged but not fatal to the classification result.
      console.error('[classify] audit_log insert failed', auditErr.message);
    }

    return NextResponse.json({
      ok: true,
      email_id: emailId,
      category: result.category,
      confidence: result.confidence,
      classified_at: nowIso,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'classify_failed', detail: msg }, { status: 500 });
  }
}
