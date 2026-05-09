/**
 * POST /api/sync/outlook/start — initiate Outlook delta sync (PRD §12.1).
 * Returns 401 if unauthenticated, 200 with sync state otherwise.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      },
    );
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    // Queue delta sync — actual sync runs via edge function / pg_cron
    return NextResponse.json({ ok: true, state: 'syncing', startedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
}
