/**
 * POST /api/edge/classify
 * PRD §7.9 — Classification engine edge function.
 *
 * Classifies pending (unclassified) emails for the authenticated user.
 * Calls classifyPendingForUser which runs classifyEmail per row,
 * persists category + classified_at, and writes audit_log entries.
 *
 * Accepts optional `limit` (default 25, max 100) in request body.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { classifyPendingForUser, type MinimalSupabaseLike } from '@/lib/classify/batch';

export const dynamic = 'force-dynamic';

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          for (const { name, value, options } of toSet) {
            try {
              cookieStore.set(name, value, options);
            } catch {
              /* read-only context, ignore */
            }
          }
        },
      },
    },
  );
}

export async function POST(req: Request) {
  try {
    const supabase = await getSupabase();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const limit =
      typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 100) : 25;

    const result = await classifyPendingForUser(
      supabase as unknown as MinimalSupabaseLike,
      user.id,
      limit,
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'classify_failed', detail: msg }, { status: 500 });
  }
}
