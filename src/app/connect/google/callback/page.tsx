'use client';

/**
 * /connect/google/callback — client-side Google OAuth callback handler.
 *
 * Reached after Google's consent screen redirects back to the app. It:
 *  1. Handles ?error= params (user denied consent, provider error)
 *  2. Exchanges ?code= for a Supabase session via PKCE
 *  3. POSTs provider tokens to /api/oauth/gmail/tokens for encrypted storage
 *  4. Redirects to /onboarding/sync
 *
 * Token save failure is non-fatal: if POST /api/oauth/gmail/tokens fails
 * the user still proceeds to onboarding (§5.2).
 *
 * When no ?code= is present (hash/implicit flow), redirects to /onboarding/sync
 * directly — middleware will re-check auth on protected routes.
 *
 * PRD §4.2 (OAuth token storage) · §5.2 (Onboarding) · §7.1 (Google OAuth)
 * AINBOX-17
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/client';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Read directly from window.location to avoid the Suspense boundary
    // requirement that useSearchParams() imposes in App Router.
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const oauthDesc = params.get('error_description');
    const code = params.get('code');

    if (oauthError) {
      setError(oauthDesc || oauthError);
      return;
    }

    const supabase = getBrowserSupabase();

    if (!code) {
      // No code + no error: PKCE exchange already completed (hash/implicit
      // flow) or the user navigated here after a prior sign-in. Redirect to
      // onboarding — middleware will re-check auth on protected routes.
      router.replace('/onboarding/sync');
      return;
    }

    // PKCE code exchange
    void supabase.auth
      .exchangeCodeForSession(code)
      .then(async ({ data, error: exchErr }) => {
        if (exchErr) {
          setError(exchErr.message);
          return;
        }
        const session = data?.session;
        if (!session) {
          setError('no_session');
          return;
        }

        // POST provider tokens to encrypted storage (§4.2).
        // Non-fatal: token save failure must not block the user (§5.2).
        if (session.provider_refresh_token) {
          try {
            await fetch('/api/oauth/gmail/tokens', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider_token: session.provider_token ?? null,
                provider_refresh_token: session.provider_refresh_token,
                expires_at: session.expires_at ?? null,
                scope: null,
              }),
            });
          } catch {
            // Intentionally swallowed — non-fatal (§5.2)
          }
        }

        router.replace('/onboarding/sync');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'exchange_failed');
      });
  }, [router]);

  if (error) {
    return (
      <main className="container mx-auto px-4 py-12 max-w-md">
        <h1 className="text-2xl font-bold mb-4">Sign-in failed</h1>
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          <p className="font-medium">Could not complete Google sign-in</p>
          <p className="mt-1">{error}</p>
          <p className="mt-3">
            <a className="underline" href="/connect">
              Try again
            </a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-12 max-w-md">
      <h1 className="text-2xl font-bold mb-4">Completing sign-in…</h1>
      <p className="text-slate-600">Connecting your Google account…</p>
    </main>
  );
}
