/**
 * Cron-driven auto-send executor — invoked by Vercel Cron / pg_cron every minute.
 *
 * PRD: §7.12 — sends drafts whose scheduled_send_at has elapsed AND status='pending'.
 * Re-validates the 0.85 floor at send time (defence-in-depth, §9.2).
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` header. Uses the
 * service role to operate across tenants because cron is a system action,
 * not a user action.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AUTO_SEND_MIN_THRESHOLD } from '@/lib/automation/auto-send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH_LIMIT = 100;

interface DueDraft {
  id: string;
  user_id: string;
  category: string | null;
  confidence: number | null;
  scheduled_send_at: string;
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const nowIso = new Date().toISOString();

  const { data: due, error: fetchErr } = await supabase
    .from('drafts')
    .select('id, user_id, category, confidence, scheduled_send_at')
    .eq('status', 'pending')
    .not('scheduled_send_at', 'is', null)
    .lte('scheduled_send_at', nowIso)
    .limit(BATCH_LIMIT);

  if (fetchErr) {
    return NextResponse.json(
      { error: 'fetch_failed', detail: fetchErr.message },
      { status: 500 },
    );
  }

  const sent: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const d of (due ?? []) as DueDraft[]) {
    // Defence-in-depth: re-check the 0.85 floor against current config.
    if (d.confidence == null || d.confidence < AUTO_SEND_MIN_THRESHOLD) {
      await markSkipped(supabase, d, 'confidence_below_floor');
      skipped.push({ id: d.id, reason: 'confidence_below_floor' });
      continue;
    }
    if (!d.category) {
      await markSkipped(supabase, d, 'no_category');
      skipped.push({ id: d.id, reason: 'no_category' });
      continue;
    }

    const { data: cfg } = await supabase
      .from('automation_config')
      .select('enabled, threshold')
      .eq('user_id', d.user_id)
      .eq('category', d.category)
      .maybeSingle<{ enabled: boolean; threshold: number }>();

    if (!cfg || !cfg.enabled) {
      await markSkipped(supabase, d, 'category_disabled_at_send_time');
      skipped.push({ id: d.id, reason: 'category_disabled_at_send_time' });
      continue;
    }
    if (
      cfg.threshold < AUTO_SEND_MIN_THRESHOLD ||
      d.confidence < cfg.threshold
    ) {
      await markSkipped(supabase, d, 'threshold_changed_below_match');
      skipped.push({ id: d.id, reason: 'threshold_changed_below_match' });
      continue;
    }

    // Mark as sent. Real Gmail/Graph send is a separate concern (§7.10/§7.12);
    // this executor flips status atomically so the same draft cannot be
    // double-sent if the cron overlaps. The actual send is invoked
    // downstream off the `sent_at` transition (Realtime trigger / worker).
    const { data: updated, error: updateErr } = await supabase
      .from('drafts')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        scheduled_send_at: null,
      })
      .eq('id', d.id)
      .eq('status', 'pending')
      .not('scheduled_send_at', 'is', null)
      .select('id')
      .maybeSingle();

    if (updateErr || !updated) {
      skipped.push({ id: d.id, reason: 'update_lost_race' });
      continue;
    }

    await supabase.from('audit_log').insert({
      user_id: d.user_id,
      draft_id: d.id,
      action: 'auto_send_dispatched',
      meta: {
        category: d.category,
        confidence: d.confidence,
        threshold: cfg.threshold,
        scheduled_send_at: d.scheduled_send_at,
        dispatched_at: new Date().toISOString(),
      },
    });
    sent.push(d.id);
  }

  return NextResponse.json({
    ok: true,
    examined: due?.length ?? 0,
    sent: sent.length,
    skipped: skipped.length,
    detail: { sent, skipped },
  });
}

async function markSkipped(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  d: DueDraft,
  reason: string,
) {
  await supabase
    .from('drafts')
    .update({ scheduled_send_at: null })
    .eq('id', d.id)
    .eq('status', 'pending');
  await supabase.from('audit_log').insert({
    user_id: d.user_id,
    draft_id: d.id,
    action: 'auto_send_aborted',
    meta: { reason, examined_at: new Date().toISOString() },
  });
}
