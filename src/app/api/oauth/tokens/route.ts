/**
 * GET /api/oauth/tokens
 * Returns the authenticated user's connected providers (oauth_tokens rows),
 * shaped for the /settings page.
 */
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = { provider: 'gmail' | 'outlook'; created_at: string; updated_at: string };

export async function GET(): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('provider, created_at, updated_at')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userEmail = user.email ?? null;
  const providers = (data as Row[] | null ?? []).map((r) => ({
    id: r.provider,
    type: r.provider === 'gmail' ? 'google' : 'microsoft',
    name: r.provider === 'gmail' ? 'Google' : 'Microsoft',
    email: userEmail,
    connected: true,
    connectedAt: r.created_at,
  }));

  return NextResponse.json({ ok: true, providers, userEmail });
}
