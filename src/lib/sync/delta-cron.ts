/**
 * AINBOX-30: §7.5 Email sync — incremental delta orchestration for pg_cron invocation.
 *
 * Provides pure, injectable orchestration functions for multi-user delta sync runs.
 * The route handlers (src/app/api/edge/) wire production deps; tests inject mocks.
 *
 * One user's failure never blocks the rest — each user is isolated and errors are
 * captured in the result list. Users who haven't completed backfill yet (§7.3) are
 * soft-skipped with a `skipped: true` marker.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface UserTokenRow {
  /** Supabase user UUID. */
  userId: string;
  /** Decrypted refresh token — never logged, never persisted post-use. */
  refreshToken: string;
}

export interface DeltaCronUserResult {
  userId: string;
  ok: boolean;
  /** Number of messages newly synced (ok === true). */
  synced?: number;
  /** True when the user hasn't completed backfill yet (§7.3 must precede §7.5). */
  skipped?: boolean;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Gmail delta cron (§7.5)
// ---------------------------------------------------------------------------

export interface GmailDeltaCronDeps {
  /** Return all users with valid Gmail oauth tokens. */
  listUsers: () => Promise<UserTokenRow[]>;
  /**
   * Run incremental delta sync for a single user.
   * Throws with "no historyId" if backfill hasn't run yet.
   */
  syncUser: (userId: string, refreshToken: string) => Promise<{ newOrChanged: number; newHistoryId: string | null }>;
  /** Optional per-user callback for streaming / logging. */
  onResult?: (r: DeltaCronUserResult) => void;
}

export interface DeltaCronSummary {
  results: DeltaCronUserResult[];
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

/**
 * Iterate all Gmail users and run incremental delta sync for each.
 * Called every 60s by pg_cron via POST /api/edge/email-sync-gmail (§7.5).
 */
export async function runGmailDeltaCron(deps: GmailDeltaCronDeps): Promise<DeltaCronSummary> {
  const users = await deps.listUsers();
  const results: DeltaCronUserResult[] = [];

  for (const u of users) {
    let res: DeltaCronUserResult;
    try {
      const r = await deps.syncUser(u.userId, u.refreshToken);
      res = { userId: u.userId, ok: true, synced: r.newOrChanged };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Backfill guard: "no historyId" means the user hasn't completed §7.3 yet.
      const skipped = msg.includes('no historyId');
      res = { userId: u.userId, ok: false, skipped, errorMessage: msg };
    }
    results.push(res);
    deps.onResult?.(res);
  }

  return {
    results,
    total: users.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
  };
}

// ---------------------------------------------------------------------------
// Outlook delta cron (§7.5)
// ---------------------------------------------------------------------------

export interface OutlookDeltaCronDeps {
  /** Return all users with valid Outlook oauth tokens. */
  listUsers: () => Promise<UserTokenRow[]>;
  /**
   * Run incremental delta sync for a single user.
   * Uses the persisted delta token from email_sync_state.
   */
  syncUser: (userId: string, refreshToken: string) => Promise<{ persisted: number; deltaToken: string | null }>;
  /** Optional per-user callback for streaming / logging. */
  onResult?: (r: DeltaCronUserResult) => void;
}

/**
 * Iterate all Outlook users and run incremental delta sync for each.
 * Called every 60s by pg_cron via POST /api/edge/email-sync-outlook (§7.5).
 */
export async function runOutlookDeltaCron(deps: OutlookDeltaCronDeps): Promise<DeltaCronSummary> {
  const users = await deps.listUsers();
  const results: DeltaCronUserResult[] = [];

  for (const u of users) {
    let res: DeltaCronUserResult;
    try {
      const r = await deps.syncUser(u.userId, u.refreshToken);
      res = { userId: u.userId, ok: true, synced: r.persisted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res = { userId: u.userId, ok: false, skipped: false, errorMessage: msg };
    }
    results.push(res);
    deps.onResult?.(res);
  }

  return {
    results,
    total: users.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
  };
}
