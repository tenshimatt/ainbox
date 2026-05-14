/**
 * TASKRESPONSE-20: POST /api/edge/email-sync-outlook — Outlook sync edge trigger.
 *
 * PRD anchors: §3.8, §4.2, §4.3, §7.4 (backfill), §7.5 (incremental),
 *              §7.17 (retries), §7.18 (rate limits).
 *
 * This is the unified trigger endpoint designed for both user-initiated
 * and pg_cron-driven invocations. It auto-selects sync mode:
 *   - No delta token in email_sync_state → run backfill (§7.4)
 *   - Delta token present               → run incremental (§7.5)
 *
 * Returns 401 if unauthenticated, 400 if no Microsoft OAuth token is found,
 * 200 with { ok, mode, result } on success, 500 on sync error.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  runOutlookBackfill,
  runOutlookIncremental,
  type PersistedMessage,
} from '@/lib/sync/outlook';

export const runtime = 'nodejs';

type SupabaseLike = ReturnType<typeof createServerClient>;
type SyncMode = 'backfill' | 'incremental';

async function buildClient(): Promise<SupabaseLike> {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {
          /* read-only in edge trigger */
        },
      },
    },
  );
}

function makeGetAccessToken(supabase: SupabaseLike, userId: string) {
  return async (): Promise<string> => {
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
}

function makePersistMessage(supabase: SupabaseLike) {
  return async (row: PersistedMessage): Promise<void> => {
    const { error } = await supabase
      .from('email_messages')
      .upsert(row, { onConflict: 'user_id,provider,provider_message_id' });
    if (error) throw new Error(`persistMessage failed: ${error.message}`);
  };
}

function makeSaveDeltaToken(supabase: SupabaseLike, userId: string) {
  return async (token: string): Promise<void> => {
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
}

function makeLoadDeltaToken(supabase: SupabaseLike, userId: string) {
  return async (): Promise<string | null> => {
    const { data } = await supabase
      .from('email_sync_state')
      .select('delta_token')
      .eq('user_id', userId)
      .eq('provider', 'outlook')
      .maybeSingle();
    return (data?.delta_token as string | undefined) ?? null;
  };
}

/** Determine sync mode by checking whether a delta token already exists (§7.5). */
async function resolveSyncMode(
  supabase: SupabaseLike,
  userId: string,
): Promise<SyncMode> {
  const { data } = await supabase
    .from('email_sync_state')
    .select('delta_token')
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .maybeSingle();
  const hasDelta = !!(data?.delta_token);
  return hasDelta ? 'incremental' : 'backfill';
}

export async function POST(): Promise<NextResponse> {
  // ------- Auth (RLS-scoped, never service-role — §4.1) -------
  let supabase: SupabaseLike;
  let userId: string;
  try {
    supabase = await buildClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
    }
    userId = data.user.id;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'auth_unavailable', detail: (err as Error).message },
      { status: 401 },
    );
  }

  // ------- Resolve OAuth token (depends on TASKRESPONSE-4 oauth_tokens table) -------
  const getAccessToken = makeGetAccessToken(supabase, userId);
  try {
    await getAccessToken(); // validate token exists before starting sync
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'no_oauth_token', detail: (err as Error).message },
      { status: 400 },
    );
  }

  // ------- Auto-select sync mode (§7.4 vs §7.5) -------
  let mode: SyncMode;
  try {
    mode = await resolveSyncMode(supabase, userId);
  } catch {
    mode = 'backfill'; // safe default: full sync if state lookup fails
  }

  const deps = {
    userId,
    getAccessToken,
    persistMessage: makePersistMessage(supabase),
    saveDeltaToken: makeSaveDeltaToken(supabase, userId),
    loadDeltaToken: makeLoadDeltaToken(supabase, userId),
  };

  // ------- Run sync -------
  try {
    if (mode === 'backfill') {
      const result = await runOutlookBackfill(deps);
      return NextResponse.json({ ok: true, mode, result });
    } else {
      const result = await runOutlookIncremental(deps);
      return NextResponse.json({ ok: true, mode, result });
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, mode, error: 'sync_failed', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
