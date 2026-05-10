/**
 * AINBOX-30: GET /api/cron/email-sync — cron-driven incremental delta sync.
 *
 * PRD §7.5 — invoked every 60s by pg_cron (via pg_net) or Vercel Cron.
 * Fans out to every user with a connected Gmail or Outlook account.
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` header.
 * Uses service role to query across tenants — this is a system action, not user.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runDeltaSync, type DeltaCronDeps } from '@/lib/sync/delta-cron';
import { buildGmailClient, runGmailIncremental, type SyncDeps } from '@/lib/sync/gmail';
import { runOutlookIncremental, type PersistedMessage } from '@/lib/sync/outlook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const deps: DeltaCronDeps = {
    async listSyncTargets() {
      const { data, error } = await supabase.from('oauth_tokens').select('user_id, provider');
      if (error) throw new Error(`listSyncTargets: ${error.message}`);
      return (data ?? [])
        .filter(
          (r: { provider: string }) => r.provider === 'gmail' || r.provider === 'outlook',
        )
        .map((r: { user_id: string; provider: string }) => ({
          userId: r.user_id,
          provider: r.provider as 'gmail' | 'outlook',
        }));
    },

    async syncGmailUser(userId) {
      const { data, error } = await supabase
        .from('oauth_tokens')
        .select('refresh_token')
        .eq('user_id', userId)
        .eq('provider', 'gmail')
        .maybeSingle();
      if (error || !data) throw new Error('no Gmail oauth token for user');

      const gmail = await buildGmailClient(
        (data as { refresh_token: string }).refresh_token,
      );

      const storage: SyncDeps['storage'] = {
        async persistMessage(row) {
          const { error } = await supabase
            .from('email_messages')
            .upsert(row, { onConflict: 'user_id,gmail_id' });
          if (error) throw error;
        },
        async updateSyncState(uid, state) {
          const patch: Record<string, unknown> = {
            user_id: uid,
            provider: 'gmail',
            last_synced_at: state.lastSyncedAt,
          };
          if (state.historyId !== undefined) patch.history_id = state.historyId;
          const { error } = await supabase
            .from('email_sync_state')
            .upsert(patch, { onConflict: 'user_id,provider' });
          if (error) throw error;
        },
        async getSyncState(uid) {
          const { data, error } = await supabase
            .from('email_sync_state')
            .select('history_id')
            .eq('user_id', uid)
            .eq('provider', 'gmail')
            .maybeSingle();
          if (error) throw error;
          if (!data) return null;
          return { historyId: (data as { history_id: string | null }).history_id };
        },
      };

      const progress: SyncDeps['progress'] = {
        // Cron context — no realtime channel; suppress progress events.
        async emit() {},
      };

      return runGmailIncremental(userId, { gmail, storage, progress });
    },

    async syncOutlookUser(userId) {
      const { data, error } = await supabase
        .from('oauth_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .eq('provider', 'microsoft')
        .maybeSingle();
      if (error || !data) throw new Error('no Outlook oauth token for user');

      const accessToken = (data as { access_token: string }).access_token;

      const persistMessage = async (row: PersistedMessage) => {
        const { error } = await supabase
          .from('email_messages')
          .upsert(row, { onConflict: 'user_id,provider,provider_message_id' });
        if (error) throw new Error(`persistMessage failed: ${error.message}`);
      };

      const saveDeltaToken = async (token: string) => {
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
        if (error) throw new Error(`saveDeltaToken: ${error.message}`);
      };

      const loadDeltaToken = async (): Promise<string | null> => {
        const { data } = await supabase
          .from('email_sync_state')
          .select('delta_token')
          .eq('user_id', userId)
          .eq('provider', 'outlook')
          .maybeSingle();
        return (data?.delta_token as string | undefined) ?? null;
      };

      return runOutlookIncremental({
        userId,
        getAccessToken: async () => accessToken,
        persistMessage,
        saveDeltaToken,
        loadDeltaToken,
      });
    },
  };

  try {
    const result = await runDeltaSync(deps);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'orchestration_failed', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
