/**
 * Edge function HTTP handler — TASKRESPONSE-30: §7.5 Email sync — incremental delta.
 *
 * PRD: §7.5  Email sync — incremental delta (cron dispatcher)
 *      §4.1  Auth model — CRON_SECRET bearer token (service-role system action exception)
 *      §7.3  Email sync — Gmail backfill → historyId anchors incremental
 *      §7.4  Email sync — Outlook backfill → deltaToken anchors incremental
 *
 * Cron dispatcher: finds all users whose backfill is complete (historyId set
 * for Gmail, deltaToken set for Outlook), then runs incremental sync for each.
 * Triggered by pg_cron every 60 seconds (see supabase/migrations/00004_delta_cron.sql).
 *
 * Pure handler over injected deps — no Deno-specific APIs so this module
 * can be imported and tested from Node.js via Playwright, while the Deno
 * entry point (index.ts) wires up the real Supabase service-role client and
 * provider SDK calls.
 *
 * Auth model:
 *   Requires `Authorization: Bearer <CRON_SECRET>` — this is a system
 *   action, not a user action; service-role is the approved exception per
 *   PRD §4.1 (internal queue processor).
 */

// ── Constants (re-exported so tests can assert limits) ────────────────────

export const DELTA_BATCH_LIMIT = 50;

// ── Types ─────────────────────────────────────────────────────────────────

export interface ReadyUserRow {
  user_id: string;
  provider: 'gmail' | 'outlook';
  /** Gmail — set after backfill; null means backfill not yet complete. */
  history_id: string | null;
  /** Outlook — set after backfill; null means backfill not yet complete. */
  delta_token: string | null;
}

export interface ProviderResult {
  userId: string;
  provider: 'gmail' | 'outlook';
  processed: number;
  error?: string;
}

/**
 * Injectable dependencies. Production wiring is in index.ts.
 * Tests inject mocks to run without network or DB.
 */
export interface DeltaSyncDeps {
  /** Validate the shared cron secret (constant-time compare in prod). */
  validateSecret: (header: string) => boolean;
  /**
   * Fetch users whose backfill is complete (historyId or deltaToken set).
   * Results capped at DELTA_BATCH_LIMIT.
   */
  fetchReadyUsers: (limit: number) => Promise<ReadyUserRow[]>;
  /**
   * Run Gmail incremental sync for userId starting from historyId.
   * Returns the new historyId to persist (null if unchanged).
   */
  runGmailIncremental: (
    userId: string,
    historyId: string,
  ) => Promise<{ processed: number; newHistoryId: string | null }>;
  /**
   * Run Outlook incremental sync for userId starting from deltaToken
   * (which is the full @odata.deltaLink URL).
   * Returns the new deltaToken to persist (null if unchanged).
   */
  runOutlookIncremental: (
    userId: string,
    deltaToken: string,
  ) => Promise<{ processed: number; newDeltaToken: string | null }>;
}

// ── Helper ────────────────────────────────────────────────────────────────

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Handler ───────────────────────────────────────────────────────────────

/**
 * Handle a POST /functions/v1/email-sync-delta request.
 *
 * Flow (PRD §7.5):
 *  1. CORS preflight passthrough.
 *  2. Reject non-POST with 405.
 *  3. Verify CRON_SECRET Bearer token → 401 if invalid.
 *  4. Parse optional { limit } from request body (capped at DELTA_BATCH_LIMIT).
 *  5. Fetch all users whose backfill is complete.
 *  6. For each ready user:
 *     a. Gmail: if history_id set → run Gmail incremental sync.
 *     b. Outlook: if delta_token set → run Outlook incremental sync.
 *     c. Per-user errors are caught — one failure does not crash the batch.
 *  7. Return { ok, examined, synced, errors, detail } summary.
 */
export async function handleDeltaSyncRequest(
  req: Request,
  deps: DeltaSyncDeps,
): Promise<Response> {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  if (!deps.validateSecret(authHeader)) {
    return json({ error: 'unauthorised' }, 401);
  }

  // ── Parse body ────────────────────────────────────────────────────────
  let limit = DELTA_BATCH_LIMIT;
  try {
    const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
    if (typeof body.limit === 'number' && body.limit > 0) {
      limit = Math.min(body.limit, DELTA_BATCH_LIMIT);
    }
  } catch {
    // use default limit
  }

  // ── Fetch ready users ─────────────────────────────────────────────────
  const readyUsers = await deps.fetchReadyUsers(limit);

  const results: ProviderResult[] = [];
  let syncedCount = 0;
  let errorCount = 0;

  // ── Process each user ─────────────────────────────────────────────────
  for (const user of readyUsers) {
    const { user_id: userId, provider, history_id, delta_token } = user;

    try {
      if (provider === 'gmail' && history_id) {
        const { processed, newHistoryId } = await deps.runGmailIncremental(
          userId,
          history_id,
        );
        results.push({ userId, provider, processed });
        if (newHistoryId !== null) syncedCount++;
        else if (processed > 0) syncedCount++;
      } else if (provider === 'outlook' && delta_token) {
        const { processed, newDeltaToken } = await deps.runOutlookIncremental(
          userId,
          delta_token,
        );
        results.push({ userId, provider, processed });
        if (newDeltaToken !== null) syncedCount++;
        else if (processed > 0) syncedCount++;
      }
      // If neither condition matched (guard: shouldn't happen given query), skip silently.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      results.push({ userId, provider, processed: 0, error: message });
      errorCount++;
    }
  }

  return json(
    {
      ok: true,
      examined: readyUsers.length,
      synced: syncedCount,
      errors: errorCount,
      detail: { results },
    },
    200,
  );
}
