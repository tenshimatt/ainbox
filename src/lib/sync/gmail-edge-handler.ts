/**
 * AINBOX-19: Gmail edge-function handler — Node-compatible core logic.
 *
 * PRD anchors:
 *   §3.8 Email APIs — googleapis is the locked Gmail SDK.
 *   §4.2 OAuth token storage — refresh token read from `oauth_tokens`, decrypted at runtime.
 *   §4.3 Email content handling — bodies persisted only via `encryptForUser`.
 *   §7.3 Email sync — Gmail backfill.
 *   §7.5 Email sync — incremental delta sync.
 *
 * This module contains the request-handling logic for the email-sync-gmail edge function,
 * extracted into Node-compatible TypeScript so it can be unit-tested with Playwright
 * (no Deno runtime required). The Deno edge function wraps equivalent logic.
 *
 * Architecture:
 *   - `handleGmailSync` is the entry point: it decides backfill vs incremental, obtains a
 *     Gmail client, and delegates to the existing worker functions in gmail.ts.
 *   - `SupabaseSyncStorage` is a concrete SyncStorage backed by a Supabase client.
 *   - `NoopProgressEmitter` is a no-op ProgressEmitter for contexts that do not need realtime.
 *
 * Dependency injection at all external boundaries keeps this fully testable without
 * a real Supabase instance or Gmail API access.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  runGmailBackfill,
  runGmailIncremental,
  type GmailLikeClient,
  type SyncStorage,
  type ProgressEmitter,
  type PersistedMessageRow,
} from './gmail';

// ---------------------------------------------------------------------------
// Supabase-backed SyncStorage
// ---------------------------------------------------------------------------

/**
 * Concrete SyncStorage that writes to the Supabase `email_messages` and
 * `email_sync_state` tables. Inherits the user's auth context from the
 * injected SupabaseClient — RLS enforces tenant isolation automatically.
 */
export class SupabaseSyncStorage implements SyncStorage {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
  ) {}

  async persistMessage(row: PersistedMessageRow): Promise<void> {
    // body_encrypted contains the full v1.<iv>.<tag>.<ct> envelope from encryptForUser.
    // We store it as a UTF-8 buffer in the bytea column; body_iv is null because
    // the IV is embedded in the envelope. Future migrations can normalise this.
    const bodyBuf = Buffer.from(row.body_encrypted, 'utf8');

    const { error } = await this.supabase.from('email_messages').upsert(
      {
        user_id: row.user_id,
        provider: 'gmail',
        external_message_id: row.gmail_id,
        thread_id: row.thread_id,
        sender_email: row.from_addr,
        subject_hash: row.subject_hash,
        body_encrypted: bodyBuf,
        body_iv: null,
        length_chars: row.size_bytes,
        received_at: row.internal_date
          ? new Date(Number(row.internal_date)).toISOString()
          : null,
        is_outbound: row.label_ids.includes('SENT'),
      },
      { onConflict: 'user_id,provider,external_message_id' },
    );
    if (error) throw new Error(`persistMessage: ${error.message}`);
  }

  async updateSyncState(
    userId: string,
    state: {
      historyId?: string | null;
      backfillCompleteAt?: string | null;
      lastSyncedAt?: string;
    },
  ): Promise<void> {
    const { error } = await this.supabase.from('email_sync_state').upsert(
      {
        user_id: userId,
        provider: 'gmail',
        history_id: state.historyId ?? null,
        last_synced_at: state.lastSyncedAt ?? new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );
    if (error) throw new Error(`updateSyncState: ${error.message}`);
  }

  async getSyncState(userId: string): Promise<{ historyId: string | null } | null> {
    const { data, error } = await this.supabase
      .from('email_sync_state')
      .select('history_id')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();
    if (error) throw new Error(`getSyncState: ${error.message}`);
    if (!data) return null;
    return { historyId: (data as { history_id: string | null }).history_id };
  }
}

// ---------------------------------------------------------------------------
// No-op progress emitter
// ---------------------------------------------------------------------------

/** ProgressEmitter that discards events. Used when no realtime channel is wired up. */
export class NoopProgressEmitter implements ProgressEmitter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async emit(_userId: string, _payload: Parameters<ProgressEmitter['emit']>[1]): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

export type SyncMode = 'backfill' | 'incremental';

export interface GmailEdgeResult {
  mode: SyncMode;
  userId: string;
  processed: number;
  historyId: string | null;
  durationMs: number;
}

export interface GmailEdgeHandlerDeps {
  userId: string;
  /**
   * Returns the **decrypted** Gmail refresh token for the authenticated user.
   * In production this reads from `oauth_tokens` and calls `decryptForUser`.
   * In tests this injects a plain-text fake token.
   */
  getRefreshToken: () => Promise<string>;
  /**
   * Builds a Gmail API client from a plain-text refresh token.
   * In production this uses `buildGmailClient` from gmail.ts.
   * In tests this injects a `GmailLikeClient` mock.
   */
  buildGmailClient: (refreshToken: string) => Promise<GmailLikeClient>;
  storage: SyncStorage;
  progress: ProgressEmitter;
  sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Core handler for the email-sync-gmail edge function.
 *
 * Decisions:
 *   - If `email_sync_state` has no `history_id` → run backfill (§7.3).
 *   - If `history_id` exists → run incremental delta sync (§7.5).
 *
 * All external dependencies (Gmail client, storage, progress emitter, sleep)
 * are injected so this function is fully testable without network access.
 */
export async function handleGmailSync(deps: GmailEdgeHandlerDeps): Promise<GmailEdgeResult> {
  const { userId, getRefreshToken, buildGmailClient, storage, progress, sleep } = deps;
  const start = Date.now();

  // Determine sync mode based on existing sync state.
  const state = await storage.getSyncState(userId);
  const mode: SyncMode = state?.historyId ? 'incremental' : 'backfill';

  // Obtain the Gmail client (decrypts + mints access token inside buildGmailClient).
  const refreshToken = await getRefreshToken();
  const gmail = await buildGmailClient(refreshToken);

  const syncDeps = { gmail, storage, progress, sleep };

  if (mode === 'backfill') {
    const result = await runGmailBackfill(userId, syncDeps);
    return {
      mode: 'backfill',
      userId,
      processed: result.processed,
      historyId: result.historyId,
      durationMs: Date.now() - start,
    };
  } else {
    const result = await runGmailIncremental(userId, syncDeps);
    return {
      mode: 'incremental',
      userId,
      processed: result.newOrChanged,
      historyId: result.newHistoryId,
      durationMs: Date.now() - start,
    };
  }
}
