/**
 * AINBOX-26: Supabase Edge Function handler — email-sync-gmail.
 *
 * PRD anchors:
 *   §4.6 Background jobs — edge function for Gmail sync.
 *   §7.3 Email sync — Gmail backfill — triggered by this handler.
 *
 * Pure handler with injectable deps. Works in both Node.js (Playwright tests)
 * and Deno 2 (production edge function). No environment-specific imports.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackfillResult {
  processed: number;
  historyId: string | null;
  durationMs: number;
}

export interface EdgeBackfillDeps {
  /**
   * Verify the Authorization header (expected: "Bearer <jwt>") and return the
   * authenticated user ID, or null if the token is missing / invalid.
   */
  verifyAuth(authHeader: string | null): Promise<string | null>;

  /**
   * Load the Gmail OAuth refresh token for the given user from `oauth_tokens`.
   * Returns null if no token exists (user has not connected Gmail).
   * Throws on storage errors.
   */
  loadRefreshToken(userId: string): Promise<string | null>;

  /**
   * Execute the Gmail backfill for the user.
   * Implementations must encrypt bodies per §4.3 and persist via UPSERT (§7.3).
   * Throws on unrecoverable error.
   */
  runBackfill(userId: string, refreshToken: string): Promise<BackfillResult>;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle a Gmail backfill request. Returns an HTTP-style `{ status, body }` pair
 * so both the Deno entry point and tests can consume it without a live server.
 */
export async function handleEdgeBackfill(
  authHeader: string | null,
  deps: EdgeBackfillDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const userId = await deps.verifyAuth(authHeader);
  if (!userId) {
    return { status: 401, body: { ok: false, error: 'unauthenticated' } };
  }

  let refreshToken: string | null;
  try {
    refreshToken = await deps.loadRefreshToken(userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'token lookup failed';
    return { status: 500, body: { ok: false, error: msg } };
  }

  if (!refreshToken) {
    return {
      status: 400,
      body: { ok: false, error: 'no Gmail oauth token for user (run /connect first)' },
    };
  }

  try {
    const result = await deps.runBackfill(userId, refreshToken);
    return { status: 202, body: { ok: true, result } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'backfill failed';
    return { status: 500, body: { ok: false, error: msg } };
  }
}
