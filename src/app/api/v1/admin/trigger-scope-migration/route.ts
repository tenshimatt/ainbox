import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

async function buildSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );
}

export async function POST(): Promise<Response> {
  let supabase;
  try {
    supabase = await buildSupabaseClient();
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Admin check via app_metadata role
  const role = (user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Trigger the backfill migration — sets email_scope_granted=false for existing rows
  const { error: dbErr } = await supabase
    .from('oauth_tokens')
    .update({ email_scope_granted: false })
    .is('email_scope_granted', null);

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
