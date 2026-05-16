/**
 * POST /api/kb/auto-verify
 * TASK7544-22 — Auto-verify the top N highest-confidence KB items so that
 * /onboarding/kb-review is no longer on the critical onboarding path.
 * Called fire-and-forget from /onboarding/sync once email sync completes.
 *
 * Selects the top AUTO_VERIFY_LIMIT unverified items (confidence DESC) and
 * sets verified=true. Already-verified items are untouched.
 */
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AUTO_VERIFY_LIMIT = 5;

export async function POST(): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // Fetch top N unverified items ordered by confidence DESC.
  const { data: items, error: fetchError } = await supabase
    .from('kb_items')
    .select('id')
    .eq('user_id', user.id)
    .eq('verified', false)
    .order('confidence', { ascending: false })
    .limit(AUTO_VERIFY_LIMIT);

  if (fetchError) {
    return NextResponse.json({ error: 'fetch_failed', detail: fetchError.message }, { status: 500 });
  }

  const ids = (items ?? []).map((r: { id: string }) => r.id);
  if (!ids.length) {
    return NextResponse.json({ ok: true, verified: 0 });
  }

  const { error: updateError } = await supabase
    .from('kb_items')
    .update({ verified: true })
    .in('id', ids)
    .eq('user_id', user.id);

  if (updateError) {
    return NextResponse.json({ error: 'update_failed', detail: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, verified: ids.length });
}
