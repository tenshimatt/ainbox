/**
 * TASKRESPONSE-36 / Personalization L1 — draft feedback capture helper.
 *
 * Insert one row in `draft_feedback` per user action on a draft.
 * Fire-and-forget by design: a feedback-insert failure must never block
 * the user's primary action (approve / reject / edit).
 *
 * PRD §4.1 (RLS — rows owned by auth.uid()), §7.11 (approval queue).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type DraftAction = 'approve' | 'reject' | 'edit' | 'send' | 'snooze';

/** Cheap Levenshtein for short reply edits (typically <500 chars). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

interface CaptureOpts {
  userId: string;
  draftId: string;
  action: DraftAction;
  /** Original draft.created_at — used to compute latency_ms. */
  draftCreatedAt?: string | null;
  /** For 'edit' only: provide before + after to compute edit_diff. */
  edit?: { before: string; after: string };
}

/**
 * Insert a draft_feedback row. Never throws; logs and swallows on failure.
 *
 * Denormalises category + sender_domain from email_messages so later
 * rule-mining queries don't need a join for every aggregation.
 */
export async function captureFeedback(
  supabase: SupabaseClient,
  opts: CaptureOpts,
): Promise<void> {
  try {
    // Lookup the draft to get email_id + maybe denormalise.
    const { data: draft } = await supabase
      .from('drafts')
      .select('id, email_id, created_at, email_messages(category, from_addr)')
      .eq('id', opts.draftId)
      .single();

    const em = (draft as { email_messages?: unknown } | null)?.email_messages;
    const emObj = Array.isArray(em) ? em[0] : em;
    const category =
      (emObj as { category?: string | null } | undefined)?.category ?? null;
    const fromAddr =
      (emObj as { from_addr?: string | null } | undefined)?.from_addr ?? null;
    const senderDomain = fromAddr ? fromAddr.split('@')[1]?.toLowerCase() ?? null : null;

    const draftCreatedAt =
      opts.draftCreatedAt ??
      (draft as { created_at?: string } | null)?.created_at ??
      null;
    const latencyMs = draftCreatedAt
      ? Math.max(0, Date.now() - new Date(draftCreatedAt).getTime())
      : null;

    const editDiff =
      opts.edit && opts.action === 'edit'
        ? {
            before: opts.edit.before.slice(0, 4000),
            after: opts.edit.after.slice(0, 4000),
            edit_distance: levenshtein(opts.edit.before, opts.edit.after),
            char_delta: opts.edit.after.length - opts.edit.before.length,
          }
        : null;

    const { error } = await supabase.from('draft_feedback').insert({
      user_id: opts.userId,
      draft_id: opts.draftId,
      email_id: (draft as { email_id?: string } | null)?.email_id ?? null,
      action: opts.action,
      edit_diff: editDiff,
      latency_ms: latencyMs,
      category,
      sender_domain: senderDomain,
    });
    if (error) {
      console.warn('[feedback/capture] insert failed', error.message);
    }
  } catch (err) {
    console.warn(
      '[feedback/capture] unhandled',
      err instanceof Error ? err.message : String(err),
    );
  }
}
