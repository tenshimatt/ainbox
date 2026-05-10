/**
 * Cron-driven delta sync dispatcher — invoked by Vercel Cron every minute.
 *
 * PRD: §7.5 — after initial backfill, run incremental delta sync for all
 * ready users (historyId set for Gmail, deltaToken set for Outlook).
 *
 * This route is a thin adapter: it validates the CRON_SECRET then forwards
 * the request to the `email-sync-delta` Supabase edge function, which holds
 * the full sync logic. This avoids duplicating provider SDK calls in Next.js.
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` header. The edge
 * function uses service-role (system action exception per PRD §4.1).
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') ?? '';

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/email-sync-delta`;

  let res: globalThis.Response;
  try {
    res = await fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed';
    return NextResponse.json(
      { error: 'edge_function_unreachable', detail: message },
      { status: 502 },
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = { raw: await res.text().catch(() => '') };
  }

  return NextResponse.json(data, { status: res.status });
}
