/**
 * Auto-send executor
 *
 * PRD: §4.4 (Confidence model — auto-send threshold MUST be ≥ 0.85)
 * PRD: §7.12 (Auto-send mode — 60s cooling delay before send)
 * PRD: §9.2 (Anti-pattern — NEVER auto-send below 0.85, non-negotiable)
 *
 * Hard floor: AUTO_SEND_MIN_THRESHOLD = 0.85.
 * Enforced in 3 places (DB CHECK constraint, API route, UI form, AND here).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const AUTO_SEND_MIN_THRESHOLD = 0.85;
export const COOLING_DELAY_SECONDS = 60;

export const CATEGORIES = [
  'sales',
  'support',
  'invoice',
  'complaint',
  'meeting',
  'investor',
  'urgent',
  'escalation',
  'spam',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface TriggerResult {
  scheduled: boolean;
  reason?: string;
  scheduledSendAt?: string;
}

interface AutomationConfigRow {
  category: Category;
  enabled: boolean;
  threshold: number;
}

interface DraftRow {
  id: string;
  user_id: string;
  category: Category | null;
  confidence: number | null;
  status: string;
  scheduled_send_at: string | null;
}

/**
 * Decide whether a draft is eligible for auto-send and, if so, schedule it
 * 60 seconds in the future. Logs to audit_log either way.
 *
 * Returns { scheduled: false, reason } when blocked. NEVER schedules below
 * the 0.85 floor regardless of user config (defence-in-depth: §9.2).
 */
export async function triggerAutoSend(
  draftId: string,
  supabase: SupabaseClient,
): Promise<TriggerResult> {
  const { data: draft, error: draftErr } = await supabase
    .from('drafts')
    .select('id, user_id, category, confidence, status, scheduled_send_at')
    .eq('id', draftId)
    .single<DraftRow>();

  if (draftErr || !draft) {
    return { scheduled: false, reason: 'draft_not_found' };
  }

  if (draft.status !== 'pending') {
    return { scheduled: false, reason: `draft_status_${draft.status}` };
  }

  if (draft.scheduled_send_at) {
    return { scheduled: false, reason: 'already_scheduled' };
  }

  if (!draft.category) {
    return { scheduled: false, reason: 'no_category' };
  }

  if (draft.confidence == null) {
    return { scheduled: false, reason: 'no_confidence' };
  }

  const { data: cfg } = await supabase
    .from('automation_config')
    .select('category, enabled, threshold')
    .eq('user_id', draft.user_id)
    .eq('category', draft.category)
    .maybeSingle<AutomationConfigRow>();

  if (!cfg || !cfg.enabled) {
    await writeAudit(supabase, draft.user_id, draftId, 'auto_send_skipped', {
      reason: 'category_disabled',
      category: draft.category,
    });
    return { scheduled: false, reason: 'category_disabled' };
  }

  // Defence-in-depth: even if a malformed row leaks past the DB CHECK
  // constraint, we refuse to schedule below the global floor.
  if (cfg.threshold < AUTO_SEND_MIN_THRESHOLD) {
    await writeAudit(supabase, draft.user_id, draftId, 'auto_send_refused', {
      reason: 'threshold_below_floor',
      threshold: cfg.threshold,
      floor: AUTO_SEND_MIN_THRESHOLD,
    });
    return { scheduled: false, reason: 'threshold_below_floor' };
  }

  if (draft.confidence < cfg.threshold) {
    await writeAudit(supabase, draft.user_id, draftId, 'auto_send_skipped', {
      reason: 'confidence_below_threshold',
      confidence: draft.confidence,
      threshold: cfg.threshold,
    });
    return { scheduled: false, reason: 'confidence_below_threshold' };
  }

  const scheduledSendAt = new Date(
    Date.now() + COOLING_DELAY_SECONDS * 1000,
  ).toISOString();

  const { error: updateErr } = await supabase
    .from('drafts')
    .update({ scheduled_send_at: scheduledSendAt })
    .eq('id', draftId)
    .eq('status', 'pending')
    .is('scheduled_send_at', null);

  if (updateErr) {
    return { scheduled: false, reason: 'update_failed' };
  }

  await writeAudit(supabase, draft.user_id, draftId, 'auto_send_scheduled', {
    category: draft.category,
    confidence: draft.confidence,
    threshold: cfg.threshold,
    scheduled_send_at: scheduledSendAt,
    cooling_seconds: COOLING_DELAY_SECONDS,
  });

  return { scheduled: true, scheduledSendAt };
}

async function writeAudit(
  supabase: SupabaseClient,
  userId: string,
  draftId: string,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      user_id: userId,
      draft_id: draftId,
      action,
      meta,
    });
  } catch {
    // Audit failure must not crash the executor; surface separately.
  }
}
