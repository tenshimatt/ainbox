/**
 * POST /api/edge/draft — background worker for reply drafting.
 *
 * PRD: §4.4 Confidence model
 *      §7.10 Reply drafting (edge function)
 *
 * This route is invoked by pg_cron or Supabase Realtime triggers after
 * email classification. It is NOT user-facing — authentication uses
 * CRON_SECRET (same pattern as /api/cron/auto-send).
 *
 * Flow:
 *   1. Verify Bearer CRON_SECRET.
 *   2. Load email row by email_id + user_id (service role; explicit
 *      user_id WHERE clause maintains tenant isolation without RLS).
 *   3. Skip spam / escalation / urgent categories (PRD §7.10).
 *   4. Run processDraftForEmail() — top-5 KB retrieval + LiteLLM call
 *      + persist draft row + audit_log (metadata only, no body).
 *   5. Return { ok, draft_id, confidence, skipped? }.
 *
 * Auto-send threshold (≥0.85) is NOT enforced here — that is the
 * responsibility of AINBOX-12 / /api/edge/auto-send.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  processDraftForEmail,
  buildWorkerDeps,
  type WorkerEmailRow,
} from '@/lib/draft/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PostBody {
  email_id: string;
  user_id: string;
}

export async function POST(req: NextRequest) {
  // Auth: CRON_SECRET (service-to-service, not user session).
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (
    !body?.email_id ||
    typeof body.email_id !== 'string' ||
    !body?.user_id ||
    typeof body.user_id !== 'string'
  ) {
    return NextResponse.json(
      { error: 'email_id and user_id required' },
      { status: 400 },
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Load email — explicit user_id WHERE clause maintains tenant isolation.
  const { data: emailRow, error: emailErr } = await supabase
    .from('email_messages')
    .select('id, user_id, subject, body, from_address, category, provider')
    .eq('id', body.email_id)
    .eq('user_id', body.user_id)
    .maybeSingle<WorkerEmailRow>();

  if (emailErr) {
    return NextResponse.json(
      { error: 'fetch_failed', detail: emailErr.message },
      { status: 500 },
    );
  }
  if (!emailRow) {
    return NextResponse.json({ error: 'email not found' }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
  const deps = buildWorkerDeps(supabase, appUrl);

  try {
    const result = await processDraftForEmail(emailRow, supabase, deps);

    if ('skipped' in result) {
      return NextResponse.json({ ok: true, ...result }, { status: 200 });
    }

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json(
      { error: 'draft_failed', detail: msg },
      { status: 500 },
    );
  }
}
