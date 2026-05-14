/**
 * GET /api/audit/export
 * TASKRESPONSE-14 — CSV export of filtered audit_log, scoped to auth.uid().
 * PRD: §5.3 §7.14 §6.1
 *
 * Same filters as /api/audit. Returns text/csv with a content-disposition
 * attachment. Bodies/PII columns are NEVER included (PRD §4.3).
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

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
              /* read-only */
            }
          }
        },
      },
    },
  );
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'object') {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  } else {
    s = String(v);
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function kbCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    const v = value as { count?: unknown; items?: unknown };
    if (typeof v.count === 'number') return v.count;
    if (Array.isArray(v.items)) return v.items.length;
  }
  return 0;
}

const COLUMNS = [
  'timestamp',
  'event_type',
  'target_id',
  'category',
  'model',
  'confidence',
  'kb_items_used',
  'details',
] as const;

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
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const eventType = url.searchParams.get('event_type');
    const category = url.searchParams.get('category');

    let q = supabase
      .from('audit_log')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (from) q = q.gte('created_at', from);
    if (to) q = q.lte('created_at', to);
    if (eventType) q = q.eq('action', eventType);
    if (category) q = q.eq('category', category);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json(
        { error: 'fetch_failed', detail: error.message },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const lines: string[] = [];
    lines.push(COLUMNS.join(','));
    for (const r of rows) {
      lines.push(
        [
          csvEscape(r.created_at),
          csvEscape(r.action),
          csvEscape(r.email_id ?? r.target_id ?? ''),
          csvEscape(r.category ?? ''),
          csvEscape(r.model ?? ''),
          csvEscape(r.confidence ?? ''),
          csvEscape(kbCount(r.kb_items_used)),
          csvEscape(r.details ?? ''),
        ].join(','),
      );
    }

    const csv = lines.join('\n') + '\n';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="audit-log-${stamp}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'export_failed', detail: msg }, { status: 500 });
  }
}
