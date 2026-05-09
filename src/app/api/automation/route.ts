/**
 * Automation config API — GET (list current settings) + PUT (upsert).
 *
 * PRD: §4.4, §7.12, §9.2
 * Threshold floor of 0.85 enforced here (server-side) AND in DB CHECK
 * AND in UI form. Three layers — see auto-send.ts.
 */

import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  AUTO_SEND_MIN_THRESHOLD,
  CATEGORIES,
  type Category,
} from '@/lib/automation/auto-send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            /* read-only context */
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            /* read-only context */
          }
        },
      },
    },
  );
}

export async function GET() {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('automation_config')
    .select('category, enabled, threshold')
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fill in defaults for any unset categories.
  const map = new Map<string, { category: Category; enabled: boolean; threshold: number }>();
  for (const c of CATEGORIES) {
    map.set(c, { category: c, enabled: false, threshold: AUTO_SEND_MIN_THRESHOLD });
  }
  for (const row of data ?? []) {
    if (CATEGORIES.includes(row.category as Category)) {
      map.set(row.category, {
        category: row.category as Category,
        enabled: !!row.enabled,
        threshold: Number(row.threshold),
      });
    }
  }

  return NextResponse.json({
    floor: AUTO_SEND_MIN_THRESHOLD,
    categories: Array.from(map.values()),
  });
}

interface PutItem {
  category: string;
  enabled: boolean;
  threshold: number;
}

export async function PUT(req: Request) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { categories?: PutItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const items = body.categories;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'categories_array_required' }, { status: 400 });
  }

  // Validate every item BEFORE persisting; threshold floor of 0.85 is
  // a hard floor — refuse the entire payload if any item violates it (§9.2).
  for (const item of items) {
    if (!CATEGORIES.includes(item.category as Category)) {
      return NextResponse.json(
        { error: 'invalid_category', category: item.category },
        { status: 400 },
      );
    }
    const t = Number(item.threshold);
    if (!Number.isFinite(t) || t < AUTO_SEND_MIN_THRESHOLD || t > 1) {
      return NextResponse.json(
        {
          error: 'threshold_out_of_range',
          category: item.category,
          threshold: item.threshold,
          floor: AUTO_SEND_MIN_THRESHOLD,
          ceiling: 1,
        },
        { status: 400 },
      );
    }
  }

  const rows = items.map((it) => ({
    user_id: user.id,
    category: it.category,
    enabled: !!it.enabled,
    threshold: Number(it.threshold),
  }));

  const { error } = await supabase
    .from('automation_config')
    .upsert(rows, { onConflict: 'user_id,category' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
