/**
 * Edge function HTTP handler — AINBOX-31: §7.12 Auto-send executor.
 *
 * PRD: §7.12 Auto-send mode
 *      §4.4  Confidence model — MIN(retrieval_score, generation_score)
 *      §9.2  Anti-pattern — NEVER auto-send below 0.85, non-negotiable
 *
 * Batch executor: finds drafts whose 60-second cooling window has elapsed,
 * re-validates every eligibility guard, then atomically flips status→sent.
 *
 * Pure handler over injected deps — no Deno-specific APIs so this module
 * can be imported and tested from Node.js via Playwright, while the Deno
 * entry point (index.ts) wires up the real Supabase service-role client.
 *
 * Auth model:
 *   Requires `Authorization: Bearer <CRON_SECRET>` — this is a system
 *   action, not a user action; service-role is the approved exception per
 *   PRD §4.1 (internal queue processor).
 */

// ── Constants (re-exported so tests can assert the floor) ─────────────────

export const AUTO_SEND_MIN_THRESHOLD = 0.85;
export const COOLING_DELAY_SECONDS = 60;
export const BATCH_LIMIT = 100;

// ── Types ─────────────────────────────────────────────────────────────────

export interface DueDraftRow {
  id: string;
  user_id: string;
  category: string | null;
  confidence: number | null;
  scheduled_send_at: string;
}

export interface AutomationConfigRow {
  enabled: boolean;
  threshold: number;
}

export interface AuditEntry {
  user_id: string;
  draft_id: string;
  event_type: string;
  metadata: Record<string, unknown>;
}

/**
 * Injectable dependencies. Production wiring is in index.ts.
 * Tests inject mocks to run without network or DB.
 */
export interface HandlerDeps {
  /** Validate the shared cron secret (constant-time compare in prod). */
  validateSecret: (header: string) => boolean;
  /**
   * Fetch all drafts that are pending AND have a scheduled_send_at <= now.
   * Results capped at BATCH_LIMIT.
   */
  fetchDueDrafts: (nowIso: string, limit: number) => Promise<DueDraftRow[]>;
  /**
   * Load the automation config for a (userId, category) pair.
   * Returns null when no matching row or when category disabled.
   */
  getAutomationConfig: (
    userId: string,
    category: string,
  ) => Promise<AutomationConfigRow | null>;
  /**
   * Atomically flip draft status pending→sent.
   * Returns true when the row was claimed (false = lost race or already sent).
   */
  markSent: (draftId: string, sentAt: string) => Promise<boolean>;
  /**
   * Clear scheduled_send_at and set status back to pending (abort path).
   * Used when a draft passes the cooling window but fails a guard re-check.
   */
  markAborted: (draftId: string) => Promise<void>;
  /** Append an audit_log row — metadata only, NO email body. */
  logAudit: (entry: AuditEntry) => Promise<void>;
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
 * Handle a POST /functions/v1/auto-send request.
 *
 * Flow (PRD §7.12):
 *  1. Verify CRON_SECRET Bearer token.
 *  2. Parse optional { limit } body.
 *  3. Fetch due drafts (status='pending', scheduled_send_at <= now).
 *  4. For each draft:
 *     a. Defence-in-depth: re-check confidence >= 0.85 floor.
 *     b. Re-check automation_config (category may have been disabled).
 *     c. Re-check confidence >= user threshold (threshold may have risen).
 *     d. Atomically flip status→sent (race-safe CAS update).
 *     e. Write dispatched/aborted audit entry.
 *  5. Return { ok, examined, sent, skipped } summary.
 */
export async function handleAutoSendRequest(
  req: Request,
  deps: HandlerDeps,
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
  let limit = BATCH_LIMIT;
  try {
    const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
    if (typeof body.limit === 'number' && body.limit > 0) {
      limit = Math.min(body.limit, BATCH_LIMIT);
    }
  } catch {
    // use default limit
  }

  const nowIso = new Date().toISOString();

  // ── Fetch due drafts ──────────────────────────────────────────────────
  const due = await deps.fetchDueDrafts(nowIso, limit);

  const sent: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  // ── Process each draft ────────────────────────────────────────────────
  for (const d of due) {
    const abort = async (reason: string) => {
      await deps.markAborted(d.id);
      await deps.logAudit({
        user_id: d.user_id,
        draft_id: d.id,
        event_type: 'auto_send_aborted',
        metadata: { reason, examined_at: nowIso },
      });
      skipped.push({ id: d.id, reason });
    };

    // Defence-in-depth: global 0.85 floor (§9.2).
    if (d.confidence == null || d.confidence < AUTO_SEND_MIN_THRESHOLD) {
      await abort('confidence_below_floor');
      continue;
    }

    if (!d.category) {
      await abort('no_category');
      continue;
    }

    // Re-check automation config (user may have toggled off since scheduling).
    const cfg = await deps.getAutomationConfig(d.user_id, d.category);
    if (!cfg || !cfg.enabled) {
      await abort('category_disabled_at_send_time');
      continue;
    }

    // Defence-in-depth: re-check threshold floor (§9.2).
    if (cfg.threshold < AUTO_SEND_MIN_THRESHOLD) {
      await abort('threshold_below_floor');
      continue;
    }

    // Re-check user threshold (user may have raised it since scheduling).
    if (d.confidence < cfg.threshold) {
      await abort('threshold_changed_below_match');
      continue;
    }

    // Atomic CAS flip pending→sent (prevents double-send on overlapping cron).
    const sentAt = new Date().toISOString();
    const claimed = await deps.markSent(d.id, sentAt);
    if (!claimed) {
      skipped.push({ id: d.id, reason: 'update_lost_race' });
      continue;
    }

    await deps.logAudit({
      user_id: d.user_id,
      draft_id: d.id,
      event_type: 'auto_send_dispatched',
      metadata: {
        category: d.category,
        confidence: d.confidence,
        threshold: cfg.threshold,
        scheduled_send_at: d.scheduled_send_at,
        dispatched_at: sentAt,
      },
    });

    sent.push(d.id);
  }

  return json({
    ok: true,
    examined: due.length,
    sent: sent.length,
    skipped: skipped.length,
    detail: { sent, skipped },
  }, 200);
}
