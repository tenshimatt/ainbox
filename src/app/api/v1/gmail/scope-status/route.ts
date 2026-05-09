import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(request: NextRequest): Promise<Response> {
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

  const connectionId = request.nextUrl.searchParams.get('connection_id');
  if (!connectionId) {
    return NextResponse.json({ error: 'connection_id required' }, { status: 400 });
  }

  const { data, error: dbErr } = await supabase
    .from('oauth_tokens')
    .select('email_scope_granted')
    .eq('user_id', user.id)
    .eq('id', connectionId)
    .maybeSingle();

  if (dbErr) {
    return NextResponse.json({ error: 'db error' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json({
    email_scope_granted: (data as { email_scope_granted: boolean | null }).email_scope_granted ?? false,
  });
}
