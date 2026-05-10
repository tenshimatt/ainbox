/**
 * AINBOX-18 — POST /api/oauth/microsoft/store-tokens
 *
 * Called by the Microsoft OAuth callback page immediately after
 * `supabase.auth.exchangeCodeForSession` succeeds. At that point the
 * Supabase session carries `provider_refresh_token` (the Microsoft refresh
 * token). This route:
 *
 *   1. Resolves the authenticated session server-side (never trust the client).
 *   2. Extracts `provider_refresh_token` — throws 400 if absent.
 *   3. Encrypts the refresh token via AINBOX-5 `encryptForUser` (per-user AES-256-GCM).
 *   4. Upserts into `oauth_tokens` with provider='microsoft'.
 *
 * The access token (`provider_token`) is intentionally NOT persisted — it
 * expires in ≈1 h and must be minted on demand via the refresh token (§4.2).
 *
 * PRD §3.9 Auth stack — Supabase Auth + Azure
 * PRD §4.1 Tenant isolation — all writes scoped to auth.uid() via RLS
 * PRD §4.2 OAuth token storage — refresh tokens land in oauth_tokens (encrypted)
 * PRD §7.2 Provider OAuth — Microsoft
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { encryptForUser } from '@/lib/crypto';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (
          toSet: Array<{
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }>,
        ) => {
          for (const { name, value, options } of toSet) {
            try {
              cookieStore.set({ name, value, ...(options ?? {}) });
            } catch {
              // No-op when called from a read-only Server Component context.
            }
          }
        },
      },
    },
  );

  // Use getSession rather than getUser here: we need provider_refresh_token
  // which only lives on the session object, not on the auth.users row.
  const {
    data: { session },
    error: sessionErr,
  } = await supabase.auth.getSession();

  if (sessionErr || !session?.user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  const userId = session.user.id;
  const providerRefreshToken = session.provider_refresh_token;

  if (!providerRefreshToken) {
    // This happens when Supabase Auth wasn't configured with
    // offline_access scope or if the session was already consumed.
    return NextResponse.json(
      { ok: false, error: 'no_provider_refresh_token' },
      { status: 400 },
    );
  }

  let encryptedRefreshToken: string;
  try {
    encryptedRefreshToken = encryptForUser(userId, providerRefreshToken);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'encryption_failed', detail: (err as Error).message },
      { status: 500 },
    );
  }

  // Upsert into oauth_tokens. The access token is not stored per §4.2 —
  // encrypted_access_token carries a sentinel to satisfy any NOT NULL
  // constraint on older schema versions while making the intent explicit.
  const { error: upsertErr } = await supabase
    .from('oauth_tokens')
    .upsert(
      {
        user_id: userId,
        provider: 'microsoft',
        encrypted_refresh_token: encryptedRefreshToken,
        // Access tokens expire; we never persist them (§4.2).
        encrypted_access_token: 'ephemeral',
        scope: 'Mail.Read Mail.Send User.Read offline_access',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );

  if (upsertErr) {
    return NextResponse.json(
      { ok: false, error: 'storage_failed', detail: upsertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
