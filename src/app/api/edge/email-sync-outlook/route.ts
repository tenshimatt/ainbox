/**
 * AINBOX-30: POST /api/edge/email-sync-outlook — pg_cron-triggered Outlook delta sync.
 *
 * PRD anchors: §7.5 (incremental delta), §4.1 (service role acceptable for system cron).
 *
 * Scheduled every 60s via pg_cron (see migration 0003_pg_cron_email_sync.sql).
 * Iterates all users with Outlook tokens, runs incremental delta for each.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runOutlookDeltaCron, type OutlookDeltaCronDeps } from '@/lib/sync/delta-cron';
import { runOutlookIncremental, type PersistedMessage } from '@/lib/sync/outlook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ServiceClient = ReturnType<typeof createClient>;

function makePersistMessage(supabase: ServiceClient) {
  return async (row: PersistedMessage) => {
    const { error } = await supabase
      .from('email_messages')
      .upsert(row, { onConflict: 'user_id,provider,provider_message_id' });
    if (error) throw new Error(`persistMessage failed: ${error.message}`);
  };
}

function makeSaveDeltaToken(supabase: ServiceClient, userId: string) {
  return async (token: string) => {
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

function makeLoadDeltaToken(supabase: ServiceClient, userId: string) {
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

export async function POST(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: tokens, error: listErr } = await supabase
    .from('oauth_tokens')
    .select('user_id, refresh_token')
    .eq('provider', 'outlook');

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const deps: OutlookDeltaCronDeps = {
    listUsers: async () =>
      (tokens ?? []).map((t: { user_id: string; refresh_token: string }) => ({
        userId: t.user_id,
        refreshToken: t.refresh_token,
      })),
    syncUser: async (userId, refreshToken) =>
      runOutlookIncremental({
        userId,
        getAccessToken: async () => refreshToken,
        persistMessage: makePersistMessage(supabase),
        saveDeltaToken: makeSaveDeltaToken(supabase, userId),
        loadDeltaToken: makeLoadDeltaToken(supabase, userId),
      }),
  };

  const summary = await runOutlookDeltaCron(deps);
  return NextResponse.json({ ok: true, ...summary });
}
