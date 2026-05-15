/**
 * GET /api/onboarding/status
 * Returns the user's onboarding completion flags for the sidebar progress indicator.
 * PRD: §TASK7544-16
 *
 * synced:     true when ≥1 email has been ingested
 * kbReviewed: true when ≥1 kb_item has been human-verified
 */
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const [syncedRes, verifiedRes] = await Promise.all([
    supabase.from('email_messages').select('*', { count: 'exact', head: true }),
    supabase.from('kb_items').select('*', { count: 'exact', head: true }).eq('verified', true),
  ]);

  return NextResponse.json({
    ok: true,
    synced: (syncedRes.count ?? 0) > 0,
    kbReviewed: (verifiedRes.count ?? 0) > 0,
  });
}
