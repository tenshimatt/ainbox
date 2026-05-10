/**
 * Supabase Edge Function: auto-send
 *
 * AINBOX-31: §7.12 Auto-send executor (edge function).
 *
 * PRD: §7.12 Auto-send mode — 60-second cooling delay before send.
 *      §4.4  Confidence model — floor is 0.85, never lower.
 *      §9.2  Anti-pattern — auto-send below 0.85 is non-negotiable.
 *
 * Batch executor: scans drafts whose cooling window has elapsed and
 * atomically flips status → sent. Triggered by pg_cron every minute.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (system action — uses the
 * approved service-role exception from PRD §4.1; NOT user-facing).
 *
 * Request:  POST /functions/v1/auto-send  Body: { "limit"?: number }
 * Response: { ok, examined, sent, skipped, detail }
 *
 * Deno entry point — see ./handler.ts for the pure, testable HTTP handler.
 */

// @deno-types="npm:@supabase/supabase-js@^2"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  handleAutoSendRequest,
  type HandlerDeps,
  BATCH_LIMIT,
} from './handler.ts';

// ── Config ────────────────────────────────────────────────────────────────

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ── Deno.serve entry point ────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Service-role client — bypasses RLS intentionally (internal processor).
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const deps: HandlerDeps = {
    validateSecret(header: string): boolean {
      if (!CRON_SECRET) return false;
      return header === `Bearer ${CRON_SECRET}`;
    },

    async fetchDueDrafts(nowIso: string, limit: number) {
      const { data, error } = await supabase
        .from('drafts')
        .select('id, user_id, category, confidence, scheduled_send_at')
        .eq('status', 'pending')
        .not('scheduled_send_at', 'is', null)
        .lte('scheduled_send_at', nowIso)
        .limit(Math.min(limit, BATCH_LIMIT));

      if (error) throw new Error(`fetchDueDrafts: ${error.message}`);
      return (data ?? []) as ReturnType<typeof deps.fetchDueDrafts> extends Promise<infer T> ? T : never;
    },

    async getAutomationConfig(userId: string, category: string) {
      const { data } = await supabase
        .from('automation_config')
        .select('enabled, threshold')
        .eq('user_id', userId)
        .eq('category', category)
        .maybeSingle<{ enabled: boolean; threshold: number }>();
      return data ?? null;
    },

    async markSent(draftId: string, sentAt: string): Promise<boolean> {
      const { data, error } = await supabase
        .from('drafts')
        .update({
          status: 'sent',
          sent_at: sentAt,
          scheduled_send_at: null,
        })
        .eq('id', draftId)
        .eq('status', 'pending')
        .not('scheduled_send_at', 'is', null)
        .select('id')
        .maybeSingle();

      return !error && data !== null;
    },

    async markAborted(draftId: string): Promise<void> {
      await supabase
        .from('drafts')
        .update({ scheduled_send_at: null })
        .eq('id', draftId)
        .eq('status', 'pending');
    },

    async logAudit(entry) {
      // Non-fatal: audit failure must not crash the executor.
      try {
        await supabase.from('audit_log').insert({
          user_id: entry.user_id,
          draft_id: entry.draft_id,
          event_type: entry.event_type,
          metadata: entry.metadata,
        });
      } catch (err) {
        console.error('[auto-send] audit write failed:', err);
      }
    },
  };

  return handleAutoSendRequest(req, deps);
});
