/**
 * Provider-agnostic OAuth callback (Route Handler).
 *
 * Supabase sometimes ignores the `redirectTo` we pass to signInWithOAuth
 * and falls back to the dashboard "Site URL" (root). This handler:
 *  - exchanges the `?code=` for a session
 *  - reads the linked provider off session.user.identities[0]
 *  - persists the encrypted provider_refresh_token in `oauth_tokens`
 *  - redirects to /onboarding/sync
 *
 * Reachable directly via /auth/callback?code=… or via the root
 * forwarder (see middleware) which catches stray /?code=… landings.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { encryptForUser } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROVIDER_TO_KEY: Record<string, { dbProvider: 'gmail' | 'outlook'; scope: string }> = {
  google: {
    dbProvider: 'gmail',
    scope:
      'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
  },
  azure: {
    dbProvider: 'outlook',
    scope: 'Mail.Read Mail.Send offline_access User.Read',
  },
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  const oauthDesc = url.searchParams.get('error_description');
  const origin = url.origin;

  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/connect?error=${encodeURIComponent(oauthDesc || oauthError)}`,
    );
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

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.redirect(`${origin}/connect?error=no_session`);
  }

  const idp = session.user.identities?.[0]?.provider;
  const mapping = idp ? PROVIDER_TO_KEY[idp] : undefined;
  const refreshToken = session.provider_refresh_token;

  if (!mapping) {
    // Email/password or unknown provider — still a valid signed-in user.
    return NextResponse.redirect(`${origin}/onboarding/sync`);
  }
  if (!refreshToken) {
    // Consent screen didn't grant offline_access; user can still browse but
    // backfill won't work. Surface a warning rather than blocking.
    return NextResponse.redirect(
      `${origin}/onboarding/sync?warn=no_refresh_token`,
    );
  }

  try {
    const encrypted = await encryptForUser(session.user.id, refreshToken);
    const { error: upsertErr } = await supabase
      .from('oauth_tokens')
      .upsert(
        {
          user_id: session.user.id,
          provider: mapping.dbProvider,
          encrypted_access_token: '',
          encrypted_refresh_token: encrypted,
          scope: mapping.scope,
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
