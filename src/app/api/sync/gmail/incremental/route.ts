/**
 * TASKRESPONSE-5: POST /api/sync/gmail/incremental — delta-sync since last historyId.
 *
 * PRD anchors: §3.8, §4.2, §4.3, §7.5 (delta sync), §7.17 (retries), §7.18 (rate limits).
 *
 * Reads `email_sync_state.history_id` for the user, calls `users.history.list` from there,
 * persists any new/changed messages with encrypted bodies, and advances the history pointer.
 * Designed to be invoked every 60s by pg_cron (§7.5) or on-demand.
 */

import { NextResponse } from 'next/server';
import { buildGmailClient, runGmailIncremental, type SyncDeps } from '@/lib/sync/gmail';
import { buildSupabaseServerClient } from '@/app/api/sync/gmail/route';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';

type SupabaseLike = ReturnType<typeof createServerClient>;

function makeStorage(supabase: SupabaseLike) {
  return {
    async persistMessage(row: Parameters<SyncDeps['storage']['persistMessage']>[0]) {
      const { error } = await supabase
        .from('email_messages')
        .upsert(row, { onConflict: 'user_id,gmail_id' });
      if (error) throw error;
    },
    async updateSyncState(
      userId: string,
      state: Parameters<SyncDeps['storage']['updateSyncState']>[1],
    ) {
      const patch: Record<string, unknown> = {
        user_id: userId,
        provider: 'gmail',
        last_synced_at: state.lastSyncedAt,
      };
      if (state.historyId !== undefined) patch.history_id = state.historyId;
      const { error } = await supabase
        .from('email_sync_state')
        .upsert(patch, { onConflict: 'user_id,provider' });
      if (error) throw error;
    },
    async getSyncState(userId: string) {
      const { data, error } = await supabase
        .from('email_sync_state')
        .select('history_id')
        .eq('user_id', userId)
        .eq('provider', 'gmail')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { historyId: (data as { history_id: string | null }).history_id };
    },
  };
}

function makeProgress(supabase: SupabaseLike) {
  return {
    async emit(userId: string, payload: Parameters<SyncDeps['progress']['emit']>[1]) {
      const channel = supabase.channel(`sync:${userId}`);
      await channel.send({ type: 'broadcast', event: 'gmail-sync-progress', payload });
    },
  };
}

async function loadRefreshToken(supabase: SupabaseLike, userId: string): Promise<string> {
  // depends on TASKRESPONSE-4 migration.
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('no Gmail oauth token for user');
  return (data as { refresh_token: string }).refresh_token;
}

async function handleIncremental(opts: {
  userId: string;
  deps: SyncDeps;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const result = await runGmailIncremental(opts.userId, opts.deps);
    return { status: 200, body: { ok: true, result } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    const code = msg.includes('no historyId') ? 409 : 500;
    return { status: code, body: { ok: false, error: msg } };
  }
}

export async function POST(): Promise<Response> {
  const supabase = await buildSupabaseServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  let refreshToken: string;
  try {
    refreshToken = await loadRefreshToken(supabase, user.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'oauth lookup failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const gmail = await buildGmailClient(refreshToken);
  const deps: SyncDeps = {
    gmail,
    storage: makeStorage(supabase),
    progress: makeProgress(supabase),
  };

  const { status, body } = await handleIncremental({ userId: user.id, deps });
  return NextResponse.json(body, { status });
}
