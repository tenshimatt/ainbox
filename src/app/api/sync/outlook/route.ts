/**
 * POST /api/sync/outlook — kick off Outlook backfill (PRD §7.4).
 *
 * AINBOX-18: getAccessToken now performs a real Microsoft token refresh.
 *   1. Read the encrypted refresh token from oauth_tokens.
 *   2. Decrypt + exchange via Microsoft's /token endpoint (refreshMicrosoftToken).
 *   3. If Microsoft issues a new refresh token, persist it back to oauth_tokens.
 *   4. Return the fresh access token (in-memory only — never stored per §4.2).
 *
 * PRD: §3.8 §4.2 §4.3 §7.4 §7.17 §7.18
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { runOutlookBackfill, type PersistedMessage } from '@/lib/sync/outlook';
import { refreshMicrosoftToken } from '@/lib/auth/microsoft-refresh';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  // ------- Auth (server-side, never service-role) -------
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
            /* read-only in this route */
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

  // ------- Wire dependencies (AINBOX-4 owned tables) -------

  /**
   * AINBOX-18: real token refresh.
   * Read encrypted_refresh_token → decrypt → exchange with Microsoft → return
   * fresh access token. Persists a rotated refresh token if Microsoft issued one.
   */
  const getAccessToken = async (): Promise<string> => {
    if (!supabase) throw new Error('supabase unavailable');
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('encrypted_refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'microsoft')
      .single();
    if (error || !data?.encrypted_refresh_token) {
      throw new Error(
        'no microsoft oauth token for user (run /connect/microsoft first)',
      );
    }
    const { accessToken, newEncryptedRefreshToken } =
      await refreshMicrosoftToken(
        data.encrypted_refresh_token as string,
        userId,
      );
    if (newEncryptedRefreshToken) {
      // Microsoft rotated the refresh token — persist the new one so the
      // next sync still works. Fire-and-forget: don't block the sync on it.
      supabase
        .from('oauth_tokens')
        .update({
          encrypted_refresh_token: newEncryptedRefreshToken,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('provider', 'microsoft')
        .then(() => {
          /* best-effort */
        });
    }
    return accessToken;
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

  // ------- Run backfill -------
  try {
    const result = await runOutlookBackfill({
      userId,
      getAccessToken,
      persistMessage,
      saveDeltaToken,
      loadDeltaToken,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'backfill_failed', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
