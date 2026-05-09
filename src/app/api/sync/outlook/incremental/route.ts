/**
 * POST /api/sync/outlook/incremental — delta poll (PRD §7.5).
 *
 * Uses the persisted delta token from email_sync_state.delta_token. Designed
 * to be called every 60s by pg_cron.
 *
 * PRD: §3.8 §4.2 §4.3 §7.5 §7.17 §7.18
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { runOutlookIncremental, type PersistedMessage } from '@/lib/sync/outlook';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  let userId: string;
  let supabase: ReturnType<typeof createServerClient> | null = null;
  try {
    const cookieStore = await cookies();
    supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {
            /* read-only */
          },
        },
      },
    );
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    userId = data.user.id;
  } catch (err) {
    return NextResponse.json(
      { error: 'auth_unavailable', detail: (err as Error).message },
      { status: 401 },
    );
  }

  const getAccessToken = async (): Promise<string> => {
    if (!supabase) throw new Error('supabase unavailable');
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('access_token')
      .eq('user_id', userId)
      .eq('provider', 'microsoft')
      .single();
    if (error || !data?.access_token) {
      throw new Error('no microsoft oauth token for user');
    }
    return data.access_token as string;
  };

  const persistMessage = async (row: PersistedMessage): Promise<void> => {
    if (!supabase) throw new Error('supabase unavailable');
    const { error } = await supabase
      .from('email_messages')
      .upsert(row, { onConflict: 'user_id,provider,provider_message_id' });
    if (error) throw new Error(`persistMessage failed: ${error.message}`);
  };

  const saveDeltaToken = async (token: string): Promise<void> => {
    if (!supabase) throw new Error('supabase unavailable');
    const { error } = await supabase
      .from('email_sync_state')
      .upsert(
        {
          user_id: userId,
          provider: 'outlook',
          delta_token: token,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );
    if (error) throw new Error(`saveDeltaToken failed: ${error.message}`);
  };

  const loadDeltaToken = async (): Promise<string | null> => {
    if (!supabase) throw new Error('supabase unavailable');
    const { data } = await supabase
      .from('email_sync_state')
      .select('delta_token')
      .eq('user_id', userId)
      .eq('provider', 'outlook')
      .maybeSingle();
    return (data?.delta_token as string | undefined) ?? null;
  };

  try {
    const result = await runOutlookIncremental({
      userId,
      getAccessToken,
      persistMessage,
      saveDeltaToken,
      loadDeltaToken,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'delta_failed', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
