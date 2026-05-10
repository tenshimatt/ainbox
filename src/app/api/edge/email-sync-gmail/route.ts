/**
 * AINBOX-30: POST /api/edge/email-sync-gmail — pg_cron-triggered Gmail delta sync.
 *
 * PRD anchors: §7.5 (incremental delta), §4.1 (tenant isolation — service role
 * is acceptable here because this is a system-level cron, NOT a user-facing route).
 *
 * Scheduled every 60s via pg_cron (see migration 0003_pg_cron_email_sync.sql).
 * Iterates all users with Gmail tokens, runs incremental delta for each.
 * Progress events are not emitted for cron runs — no client channel is open.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runGmailDeltaCron, type GmailDeltaCronDeps } from '@/lib/sync/delta-cron';
import { buildGmailClient, runGmailIncremental, type SyncDeps } from '@/lib/sync/gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Storage wiring (service-role client — cron operates across all tenants)
// ---------------------------------------------------------------------------

type ServiceClient = ReturnType<typeof createClient>;

function makeStorage(supabase: ServiceClient): SyncDeps['storage'] {
  return {
    async persistMessage(row) {
      const { error } = await supabase
        .from('email_messages')
        .upsert(row, { onConflict: 'user_id,gmail_id' });
      if (error) throw error;
    },
    async updateSyncState(userId, state) {
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
    async getSyncState(userId) {
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

// Progress is a no-op for cron runs: no client Realtime channel is active.
const cronProgress: SyncDeps['progress'] = {
  async emit(_userId, _payload) {
    /* intentionally empty — cron runs have no client to notify */
  },
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

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
    .eq('provider', 'gmail');

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const storage = makeStorage(supabase);

  const deps: GmailDeltaCronDeps = {
    listUsers: async () =>
      (tokens ?? []).map((t: { user_id: string; refresh_token: string }) => ({
        userId: t.user_id,
        refreshToken: t.refresh_token,
      })),
    syncUser: async (userId, refreshToken) => {
      const gmail = await buildGmailClient(refreshToken);
      return runGmailIncremental(userId, { gmail, storage, progress: cronProgress });
    },
  };

  const summary = await runGmailDeltaCron(deps);
  return NextResponse.json({ ok: true, ...summary });
}
