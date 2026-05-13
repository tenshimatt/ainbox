/**
 * Auth middleware (PRD §3.9, §4.1).
 *
 * Protects authenticated app surfaces (PRD §5.3): /inbox, /drafts,
 * /knowledge, /automation, /audit, /settings. Unauthenticated requests
 * are redirected to /connect (the provider chooser, PRD §5.2).
 *
 * Public surfaces (/, /pricing, /security, /legal/*, /connect/*,
 * /onboarding/*) are not protected here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getMiddlewareSupabase } from '@/lib/supabase/server';

const PROTECTED_PREFIXES = [
  '/inbox',
  '/drafts',
  '/knowledge',
  '/automation',
  '/audit',
  '/settings',
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  if (!isProtected(pathname)) {
    return NextResponse.next();
  }

  // Allow Playwright e2e tests to bypass auth in non-production environments.
  if (
    process.env.NODE_ENV !== 'production' &&
    req.headers.get('x-e2e-test-bypass-auth') === 'true'
  ) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const supabase = getMiddlewareSupabase(req, res);

  let user: unknown = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data?.user ?? null;
  } catch {
    user = null;
  }

  if (!user) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/connect';
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}

export const config = {
  matcher: [
    '/inbox/:path*',
    '/drafts/:path*',
    '/knowledge/:path*',
    '/automation/:path*',
    '/audit/:path*',
    '/settings/:path*',
  ],
};
