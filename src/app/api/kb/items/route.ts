/**
 * GET /api/kb/items
 * AINBOX-8 — Paginated list of kb_items for the authenticated user,
 * grouped by type, ordered by confidence DESC.
 * PRD: §7.6 §7.7
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { KB_ITEM_TYPES, type KbItemType } from '@/lib/kb/extract';

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

interface KbRow {
  id: string;
  user_id: string;
  type: KbItemType;
  content: string;
  confidence: number;
  source_email_id: string | null;
  human_verified: boolean;
  created_at?: string;
}

export async function GET(req: Request) {
  try {
    const supabase = await getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabase
      .from('kb_items')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('confidence', { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as KbRow[];
    const grouped: Record<KbItemType, KbRow[]> = {
      faq: [],
      policy: [],
      pricing: [],
      preference: [],
      contact: [],
      signature: [],
      'tone-sample': [],
    };
    for (const r of rows) {
      if (KB_ITEM_TYPES.includes(r.type)) grouped[r.type].push(r);
    }

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total: count ?? rows.length,
      items: rows,
      grouped,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'list_failed', detail: msg }, { status: 500 });
  }
}
