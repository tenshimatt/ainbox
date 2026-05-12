/**
 * POST /api/kb/extract
 *
 * Thin proxy: validates the user via Supabase session, then forwards to
 * the deployed `kb-extract` edge function using the service-role bearer.
 * The edge function does the mining + upsert into kb_items.
 * Manual-trigger sibling of the pg_cron schedule (every 5 min).
 */
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: 'misconfigured', detail: 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' },
      { status: 500 },
    );
  }

  // Vercel's serverless functions default to a short timeout; the edge fn
  // can take 5-20s. Use AbortController with 50s ceiling and surface the
  // real reason if it dies.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const resp = await fetch(`${url}/functions/v1/kb-extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ user_id: user.id }),
      signal: controller.signal,
    });
    const text = await resp.text();
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 500) }; }
    return NextResponse.json(payload, { status: resp.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : 'unknown';
    console.error('[kb/extract] edge_call_failed', { name, msg });
    return NextResponse.json(
      { error: 'edge_call_failed', name, detail: msg },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
