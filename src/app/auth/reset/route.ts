/**
 * One-click escape from stale auth state.
 *
 * Clears every `sb-*` cookie (Supabase session + PKCE verifier) and
 * redirects to /connect, so the user can start a fresh sign-in flow
 * without manually clearing browser data.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const next = url.searchParams.get('next') ?? '/connect';
  const res = NextResponse.redirect(`${url.origin}${next}`);

  const cookieStore = await cookies();
  for (const c of cookieStore.getAll()) {
    if (c.name.startsWith('sb-') || c.name.startsWith('supabase-')) {
      res.cookies.set({ name: c.name, value: '', path: '/', maxAge: 0 });
    }
  }
  return res;
}
