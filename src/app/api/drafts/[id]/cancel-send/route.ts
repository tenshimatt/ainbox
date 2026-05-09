/**
 * Cancel a scheduled auto-send during the 60-second cooling window.
 *
 * PRD: §7.12 — user can intercept from inbox view before cooling expires.
 */

import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try { cookieStore.set({ name, value, ...options }); } catch { /* */ }
        },
        remove(name: string, options: CookieOptions) {
          try { cookieStore.set({ name, value: '', ...options }); } catch { /* */ }
        },
      },
    },
  );
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { data: draft, error: readErr } = await supabase
    .from('drafts')
    .select('id, user_id, status, scheduled_send_at')
    .eq('id', id)
    .single();

  if (readErr || !draft) {
    return NextResponse.json({ error: 'draft_not_found' }, { status: 404 });
  }
  if (draft.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (draft.status !== 'pending') {
    return NextResponse.json(
      { error: 'cannot_cancel', status: draft.status },
      { status: 409 },
    );
  }
  if (!draft.scheduled_send_at) {
    return NextResponse.json({ error: 'not_scheduled' }, { status: 409 });
  }
  if (new Date(draft.scheduled_send_at).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'cooling_expired' },
      { status: 409 },
    );
  }

  const { error: updateErr } = await supabase
    .from('drafts')
    .update({ scheduled_send_at: null })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('status', 'pending');

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await supabase.from('audit_log').insert({
    user_id: user.id,
    draft_id: id,
    action: 'auto_send_cancelled',
    meta: { cancelled_at: new Date().toISOString() },
  });

  return NextResponse.json({ ok: true });
}
