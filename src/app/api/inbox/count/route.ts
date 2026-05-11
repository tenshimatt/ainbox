/** Simple count of email_messages for the current user. Used by the sync progress poller. */
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { count, error } = await supabase
    .from('email_messages')
    .select('*', { count: 'exact', head: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 });
}
