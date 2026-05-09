import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  // Require auth cookie — unauthenticated callers are rejected
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Supabase not configured — reject all requests
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { createServerClient } = await import('@supabase/ssr');
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Count KB items per type (no raw email content)
    const { data: kbItems } = await supabase
      .from('kb_items')
      .select('item_type')
      .eq('tenant_id', user.id);

    const counts: Record<string, number> = {};
    for (const item of kbItems ?? []) {
      const t = item.item_type ?? 'unknown';
      counts[t] = (counts[t] ?? 0) + 1;
    }

    return NextResponse.json({
      sent: true,
      kb_item_count: counts,
      total: kbItems?.length ?? 0,
    });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
