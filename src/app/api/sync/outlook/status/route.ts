/**
 * GET /api/sync/outlook/status — returns current Outlook sync state (PRD §12.1).
 * Returns 401 if unauthenticated, 200 with state otherwise.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
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
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return NextResponse.json({ error: 'unauthenticated', state: 'not_connected' }, { status: 401 });
    }

    // Check if Outlook token exists
    const { data: tokenRow } = await supabase
      .from('oauth_tokens')
      .select('created_at')
      .eq('user_id', data.user.id)
      .eq('provider', 'microsoft')
      .maybeSingle();

    if (!tokenRow) {
      return NextResponse.json({ state: 'not_connected' });
    }

    // Check sync state
    const { data: syncRow } = await supabase
      .from('email_sync_state')
      .select('last_synced_at, delta_token')
      .eq('user_id', data.user.id)
      .eq('provider', 'outlook')
      .maybeSingle();

    return NextResponse.json({
      state: syncRow?.delta_token ? 'complete' : 'idle',
      lastSyncedAt: syncRow?.last_synced_at ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'unauthenticated', state: 'not_connected' }, { status: 401 });
  }
}
