/**
 * PRD §3.9 Auth stack — Supabase Auth + Microsoft OAuth (Azure provider)
 * PRD §4.1 Tenant isolation — every authenticated session resolves to one auth.users row
 * PRD §4.2 OAuth token storage — refresh tokens land in `oauth_tokens` (Vault-encrypted)
 *          via a callback handler; this module is concerned with initiating the flow only
 * PRD §5.2 Onboarding — `/connect/microsoft` -> Supabase Azure OAuth -> `/connect/microsoft/callback`
 * PRD §7.2 Provider OAuth — Microsoft
 *
 * Required scopes for Outlook backfill (§7.4) + send (§7.13):
 *   - offline_access (refresh token)
 *   - Mail.Read
 *   - Mail.Send
 *   - User.Read (default — minimal profile / email claim)
 *
 * No password / no client secrets in browser. Supabase mints + redeems
 * the auth code; we just call signInWithOAuth and hand off.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabase/client';

export const MICROSOFT_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'Mail.Read',
  'Mail.Send',
  'User.Read',
] as const;

export type MicrosoftOAuthResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Build the redirect target for the Microsoft OAuth callback.
 * Always absolute so Supabase + Azure can validate it.
 */
export function getMicrosoftRedirectUrl(origin?: string): string {
  const base =
    origin ??
    (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/connect/microsoft/callback`;
}

/**
 * Initiate Supabase Azure OAuth. Returns either the URL Supabase wants
 * us to redirect to, or an error string. Caller is responsible for the
 * actual `window.location.assign` so this stays testable in jsdom.
 *
 * Uses skipBrowserRedirect so the caller controls the navigation,
 * keeping the function testable and consistent with the Google pattern.
 */
export async function startMicrosoftOAuth(
  client: SupabaseClient = getBrowserSupabase(),
): Promise<MicrosoftOAuthResult> {
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: MICROSOFT_SCOPES.join(' '),
      redirectTo: getMicrosoftRedirectUrl(),
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data?.url) {
    return { ok: false, error: 'no_oauth_url_returned' };
  }
  return { ok: true, url: data.url };
}

/**
 * Exchange a returned `code` for a session via Supabase. The Supabase
 * SSR client does this internally on `exchangeCodeForSession`; we
 * surface a thin wrapper so the callback page stays declarative and
 * we have a single seam to mock in tests.
 */
export async function completeMicrosoftOAuth(
  code: string,
  client: SupabaseClient = getBrowserSupabase(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!code) return { ok: false, error: 'missing_code' };
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
