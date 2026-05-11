/**
 * PRD §5.2, §7.1 — Google OAuth callback (server-side Route Handler).
 *
 * Server-side replaces the prior client-side page.tsx because @supabase/ssr
 * stores the PKCE verifier in an HttpOnly cookie that browser JS cannot read,
 * so `exchangeCodeForSession` from a client component fails with
 * "PKCE code verifier not found in storage". Doing the exchange in a Route
 * Handler that reads cookies via `next/headers` works correctly.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { encryptForUser } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  const oauthDesc = url.searchParams.get('error_description');
  const origin = url.origin;

  if (oauthError) {
    const msg = encodeURIComponent(oauthDesc || oauthError);
    return NextResponse.redirect(`${origin}/connect?error=${msg}`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/connect?error=missing_code`);
  }

  const supabase = await getServerSupabase();
  const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchErr) {
    return NextResponse.redirect(
      `${origin}/connect?error=${encodeURIComponent(exchErr.message)}`,
    );
  }

  const {
    data: { session },
    error: sessErr,
  } = await supabase.auth.getSession();
  if (sessErr || !session) {
    return NextResponse.redirect(`${origin}/connect?error=no_session`);
  }

  const refreshToken = session.provider_refresh_token;
  const userId = session.user.id;

  if (!refreshToken) {
    return NextResponse.redirect(`${origin}/onboarding/sync?warn=no_refresh_token`);
  }

  try {
    const encrypted = await encryptForUser(userId, refreshToken);
    const { error: upsertErr } = await supabase
      .from('oauth_tokens')
      .upsert(
        {
          user_id: userId,
          provider: 'gmail',
          encrypted_access_token: '',
          encrypted_refresh_token: encrypted,
          scope:
            'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
          expires_at: null,
        },
        { onConflict: 'user_id,provider' },
      );
    if (upsertErr) {
      return NextResponse.redirect(
        `${origin}/connect?error=${encodeURIComponent('token_storage_failed:' + upsertErr.message)}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'crypto_error';
    return NextResponse.redirect(`${origin}/connect?error=${encodeURIComponent(msg)}`);
  }

  return NextResponse.redirect(`${origin}/onboarding/sync`);
}
