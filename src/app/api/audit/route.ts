/**
 * GET /api/audit
 * AINBOX-14 — Paginated audit_log query, scoped to auth.uid().
 * PRD: §5.3 §7.14 §6.1
 *
 * Query params:
 *   - page (1-based, default 1)
 *   - pageSize (default 50, max 200)
 *   - from (ISO date)        — created_at >=
 *   - to (ISO date)          — created_at <=
 *   - event_type             — exact match on `action`
 *   - category               — exact match on `category`
 *
 * Returns: { rows: AuditRow[], total: number, page, pageSize }
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

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
              /* read-only context */
            }
          }
        },
      },
    },
  );
}

export type AuditRow = {
  id?: string | number;
  created_at: string;
  action: string; // event_type
  email_id?: string | null; // target_id
  category?: string | null;
  model?: string | null;
  confidence?: number | null;
  kb_items_used?: unknown;
  details?: unknown;
};

export async function GET(req: Request) {
  try {
    const supabase = await getSupabase();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get('pageSize') ?? '50') || 50),
    );
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const eventType = url.searchParams.get('event_type');
    const category = url.searchParams.get('category');

    let q = supabase
      .from('audit_log')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (from) q = q.gte('created_at', from);
    if (to) q = q.lte('created_at', to);
    if (eventType) q = q.eq('action', eventType);
    if (category) q = q.eq('category', category);

    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;
    q = q.range(start, end);

    const { data, error, count } = await q;
    if (error) {
      return NextResponse.json(
        { error: 'fetch_failed', detail: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      rows: (data ?? []) as AuditRow[],
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'audit_failed', detail: msg }, { status: 500 });
  }
}
