/**
 * POST /api/account/merge
 *
 * Merges a duplicate account into the authenticated user's account by calling
 * the `merge_duplicate_account` SECURITY DEFINER SQL function.
 * The function enforces that both accounts share the same email — preventing
 * cross-account data theft.
 *
 * AINBOX-50 — Merge L3
 *
 * Body:   { duplicate_user_id: string }
 * Response: { ok: true, moved_messages: number, moved_kb: number,
 *             moved_drafts: number, moved_tokens: number }
 */

import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let body: { duplicate_user_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.duplicate_user_id) {
    return NextResponse.json({ error: 'duplicate_user_id_required' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('merge_duplicate_account', {
    source_user_id: body.duplicate_user_id,
  });

  if (error) {
    const msg = error.message ?? 'merge_failed';
    if (msg.includes('email_mismatch')) {
      return NextResponse.json({ error: 'email_mismatch' }, { status: 403 });
    }
    if (msg.includes('source_not_found')) {
      return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
    }
    if (msg.includes('self_merge')) {
      return NextResponse.json({ error: 'self_merge' }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json(data);
}
