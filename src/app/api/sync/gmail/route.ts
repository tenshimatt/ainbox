/**
 * AINBOX-5: POST /api/sync/gmail — kick off Gmail backfill for the authenticated user.
 *
 * PRD anchors: §3.8, §4.2, §4.3, §7.3, §7.17, §7.18.
 *
 * Flow:
 *   1. Resolve the authenticated user from the Supabase server client (RLS-scoped, §4.1).
 *   2. Read the user's Gmail refresh token from `oauth_tokens` (depends on AINBOX-4 migration).
 *   3. Mint a Gmail API client (access tokens minted in-memory, never persisted — §4.2).
 *   4. Run `runGmailBackfill` which paginates Gmail API at ≤250 quota/sec (§7.18),
 *      persists encrypted bodies (§4.3), and emits per-batch Realtime progress.
 *
 * The handler returns immediately with 202 once the worker is dispatched. In production
 * the worker should run inside a Supabase Edge Function (`email-sync-gmail` per §4.6);
 * this Next.js route is a thin authenticated entry-point.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  buildGmailClient,
  runGmailBackfill,
  type ProgressEmitter,
  type SyncDeps,
  type SyncStorage,
} from '@/lib/sync/gmail';
import { decryptForUser } from '@/lib/crypto';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Production storage + progress wiring against Supabase.
// Kept in this file (rather than gmail.ts) so the worker remains pure & testable.
// ---------------------------------------------------------------------------

type SupabaseLike = ReturnType<typeof createServerClient>;

function makeStorage(supabase: SupabaseLike): SyncStorage {
  return {
    async persistMessage(row) {
      // UPSERT to keep backfill idempotent / resumable (§7.3).
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
      if (state.backfillCompleteAt !== undefined) patch.backfill_complete_at = state.backfillCompleteAt;
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

function makeProgress(supabase: SupabaseLike): ProgressEmitter {
  return {
    async emit(userId, payload) {
      // Per-batch event over Supabase Realtime broadcast (§7.3 "emit per-batch progress event").
      const channel = supabase.channel(`sync:${userId}`);
      await channel.send({ type: 'broadcast', event: 'gmail-sync-progress', payload });
    },
  };
}

async function loadRefreshToken(supabase: SupabaseLike, userId: string): Promise<string> {
  // depends on AINBOX-4 migration (oauth_tokens table + column-level encryption).
  // Column is `encrypted_refresh_token` (AES-256-GCM via encryptForUser — §4.2).
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('encrypted_refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('no Gmail oauth token for user (run /connect first)');
  const { encrypted_refresh_token } = data as { encrypted_refresh_token: string };
  return decryptForUser(userId, encrypted_refresh_token);
}

export async function buildSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => {
          for (const { name, value, options } of toSet) {
            try {
              cookieStore.set({ name, value, ...(options ?? {}) });
            } catch {
              // setAll is a no-op when called from a Server Component / read-only context.
            }
          }
        },
      },
    },
  );
}

/** Internal handler — exported so tests can drive it with mocked deps. */
export async function handleBackfill(opts: {
  userId: string;
  deps: SyncDeps;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const result = await runGmailBackfill(opts.userId, opts.deps);
    return { status: 202, body: { ok: true, result } };
  } catch (err) {
    // Capture EVERYTHING — googleapis throws structured non-Error objects.
    const dump = (() => {
      try {
        if (err instanceof Error) {
          return JSON.stringify({
            name: err.name,
            message: err.message,
            stack: err.stack?.split('\n').slice(0, 6).join('\n'),
            code: (err as { code?: unknown }).code,
            errors: (err as { errors?: unknown }).errors,
            responseData: (err as { response?: { data?: unknown } }).response?.data,
          });
        }
        return JSON.stringify(err, Object.getOwnPropertyNames(err as object));
      } catch {
        return String(err);
      }
    })();
    const msg = err instanceof Error ? err.message : (dump.slice(0, 200) || 'unknown error');
    console.error('[sync/gmail] backfill failed', dump);
    return { status: 500, body: { ok: false, error: msg, detail: dump.slice(0, 1200) } };
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

  const { status, body } = await handleBackfill({ userId: user.id, deps });
  return NextResponse.json(body, { status });
}
