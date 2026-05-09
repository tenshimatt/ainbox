/**
 * Google OAuth helpers (PRD §3.9, §7.1).
 *
 * Sign-in goes through Supabase Auth. We request the Gmail scopes upfront
 * so the same token grants both authentication AND the email-scope tokens
 * stored later in `oauth_tokens` (PRD §4.2).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

export const GOOGLE_CALLBACK_PATH = '/connect/google/callback';

export function buildRedirectTo(origin: string): string {
  return `${origin}${GOOGLE_CALLBACK_PATH}`;
}

export async function startGoogleOAuth(
  supabase: SupabaseClient,
  origin: string,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_SCOPES,
      redirectTo: buildRedirectTo(origin),
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });
  if (error) return { url: null, error: error.message };
  return { url: data?.url ?? null, error: null };
}
