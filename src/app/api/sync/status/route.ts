/**
 * GET /api/sync/status
 * One round-trip for the onboarding/sync progress card.
 * All counts are RLS-scoped to the authenticated user.
 */
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const [
    syncedRes,
    classifiedRes,
    draftsRes,
    kbRes,
  ] = await Promise.all([
    supabase.from('email_messages').select('*', { count: 'exact', head: true }),
    supabase.from('email_messages').select('*', { count: 'exact', head: true }).not('category', 'is', null),
    supabase.from('drafts').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('kb_items').select('*', { count: 'exact', head: true }),
  ]);

  return NextResponse.json({
    ok: true,
    counts: {
      synced:     syncedRes.count     ?? 0,
      classified: classifiedRes.count ?? 0,
      drafts:     draftsRes.count     ?? 0,
      kb:         kbRes.count         ?? 0,
    },
  });
}
