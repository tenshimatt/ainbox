/**
 * TASKRESPONSE-17: POST /api/oauth/gmail/tokens
 *
 * PRD anchors: §4.2 (OAuth token storage), §7.1 (Provider OAuth — Google).
 *
 * Saves Gmail OAuth tokens to the `oauth_tokens` table after the Google callback.
 * Refresh tokens are encrypted with AES-256-GCM per-user keys (§4.2) before storage.
 * Access tokens are also encrypted and stored with an expiry for short-lived caching.
 *
 * Called client-side from /connect/google/callback after `exchangeCodeForSession`
 * succeeds and provider tokens are present in the session. Encrypted here (server-only)
 * because the master encryption key never leaves the server runtime.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { encryptForUser } from '@/lib/crypto';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<Response> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'public-anon-key-placeholder',
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => {
          for (const { name, value, options } of toSet) {
            try {
              cookieStore.set({ name, value, ...(options ?? {}) });
            } catch {
              // read-only context (Server Component)
            }
          }
        },
      },
    },
  );

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const { provider_token, provider_refresh_token, expires_at, scope } = body as {
    provider_token?: string;
    provider_refresh_token?: string;
    expires_at?: number;
    scope?: string;
  };

  if (!provider_refresh_token) {
    return NextResponse.json({ ok: false, error: 'provider_refresh_token required' }, { status: 400 });
  }

  const encryptedRefresh = encryptForUser(user.id, provider_refresh_token);
  const encryptedAccess = provider_token ? encryptForUser(user.id, provider_token) : null;
  const expiresAt = typeof expires_at === 'number' ? new Date(expires_at * 1000).toISOString() : null;

  const row: Record<string, unknown> = {
    user_id: user.id,
    provider: 'gmail',
    encrypted_refresh_token: encryptedRefresh,
    updated_at: new Date().toISOString(),
  };
  if (encryptedAccess) row.access_token_encrypted = encryptedAccess;
  if (expiresAt) row.expires_at = expiresAt;
  if (scope) row.scope = scope;

  const { error: upsertErr } = await supabase
    .from('oauth_tokens')
    .upsert(row, { onConflict: 'user_id,provider' });

  if (upsertErr) {
    return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
