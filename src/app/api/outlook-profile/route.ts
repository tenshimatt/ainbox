/**
 * GET /api/outlook-profile — fetch Microsoft Graph /me profile (PRD §12.1).
 * Returns 401 if unauthenticated or no Outlook token.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
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

    const { data: tokenRow } = await supabase
      .from('oauth_tokens')
      .select('access_token')
      .eq('user_id', data.user.id)
      .eq('provider', 'microsoft')
      .maybeSingle();

    if (!tokenRow?.access_token) {
      return NextResponse.json({ error: 'no_outlook_token' }, { status: 401 });
    }

    const graphResp = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenRow.access_token}` },
    });

    if (!graphResp.ok) {
      return NextResponse.json({ error: 'graph_error', status: graphResp.status }, { status: 502 });
    }

    const profile = await graphResp.json();
    return NextResponse.json(profile);
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
}
