/**
 * AINBOX-30: Multi-user incremental delta sync orchestrator.
 *
 * PRD §7.5 — invoked every 60s by pg_cron. Fans out incremental sync across
 * every connected account. Per-user errors are captured so one bad account
 * cannot block others.
 *
 * The orchestrator accepts injectable deps so tests can exercise the fan-out
 * logic without hitting real Gmail, Graph, or Supabase.
 */

export interface DeltaSyncTarget {
  userId: string;
  provider: 'gmail' | 'outlook';
}

export interface DeltaCronDeps {
  /**
   * Returns all users who have a token for any provider. Service-role.
   * Called once per cron tick.
   */
  listSyncTargets(): Promise<DeltaSyncTarget[]>;

  /**
   * Run incremental Gmail delta sync for one user.
   * Throws 'no historyId' when backfill has not yet run — treated as `skipped`.
   */
  syncGmailUser(userId: string): Promise<{ newOrChanged: number }>;

  /**
   * Run incremental Outlook delta sync for one user.
   * Returns persisted count; throws on unrecoverable error.
   */
  syncOutlookUser(userId: string): Promise<{ persisted: number }>;
}

export interface DeltaCronResult {
  total: number;
  succeeded: number;
  failed: number;
  /** Accounts skipped because backfill has not yet run (§7.3 must precede §7.5). */
  skipped: number;
  errors: Array<{ userId: string; provider: string; error: string }>;
}

/**
 * Fan-out incremental sync across every connected account.
 * Sequential per-user to avoid hammering provider APIs simultaneously.
 * Per-user errors are captured and do not abort remaining accounts.
 */
export async function runDeltaSync(deps: DeltaCronDeps): Promise<DeltaCronResult> {
  const targets = await deps.listSyncTargets();
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ userId: string; provider: string; error: string }> = [];

  for (const target of targets) {
    try {
      if (target.provider === 'gmail') {
        await deps.syncGmailUser(target.userId);
      } else {
        await deps.syncOutlookUser(target.userId);
      }
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // §7.5: incremental requires prior backfill (§7.3). Not a failure — skip.
      if (msg.includes('no historyId') || msg.includes('no delta token')) {
        skipped++;
      } else {
        failed++;
      }
      errors.push({ userId: target.userId, provider: target.provider, error: msg });
    }
  }

  return { total: targets.length, succeeded, failed, skipped, errors };
}
