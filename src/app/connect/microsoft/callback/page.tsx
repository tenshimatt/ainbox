'use client';

/**
 * /connect/microsoft/callback — client-side Microsoft OAuth callback handler.
 *
 * Reached after Azure's consent screen redirects back to the app. It:
 *  1. Handles ?error= params (user declined consent, provider error)
 *  2. Handles missing ?code= (surfaces missing_code error)
 *  3. Exchanges ?code= for a Supabase session via PKCE
 *  4. POSTs Microsoft provider tokens to /api/oauth/microsoft/store-tokens
 *  5. Redirects to /onboarding/sync on full success
 *
 * Unlike the Google callback, token storage failure IS fatal here: without
 * the refresh token stored, Outlook sync cannot function.
 *
 * UI states (data-testid):
 *   ms-callback-exchanging — PKCE exchange in progress (initial load)
 *   ms-callback-success    — exchange + store succeeded (briefly before redirect)
 *   ms-callback-error      — any failure; contains error text + recovery button
 *
 * PRD §4.2 (OAuth token storage) · §5.2 (Onboarding) · §7.2 (Microsoft OAuth)
 * TASKRESPONSE-18
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/client';

type Status = 'exchanging' | 'success' | 'error';

export default function MicrosoftCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('exchanging');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const oauthDesc = params.get('error_description');
    const code = params.get('code');

    if (oauthError) {
      setErrorMessage(oauthDesc || oauthError);
      setStatus('error');
      return;
    }

    if (!code) {
      setErrorMessage('missing_code');
      setStatus('error');
      return;
    }

    const supabase = getBrowserSupabase();

    void supabase.auth
      .exchangeCodeForSession(code)
      .then(async ({ data, error: exchErr }) => {
        if (exchErr) {
          setErrorMessage(exchErr.message);
          setStatus('error');
          return;
        }
        const session = data?.session;
        if (!session) {
          setErrorMessage('no_session');
          setStatus('error');
          return;
        }

        // Store tokens — fatal for Microsoft (required for sync) — §4.2
        try {
          const res = await fetch('/api/oauth/microsoft/store-tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;
            setErrorMessage(
              (body.error as string) || `store_failed: HTTP ${res.status}`,
            );
            setStatus('error');
            return;
          }
        } catch (e) {
          setErrorMessage(
            e instanceof Error ? e.message : 'store_network_error',
          );
          setStatus('error');
          return;
        }

        setStatus('success');
        router.replace('/onboarding/sync');
      })
      .catch((e: unknown) => {
        setErrorMessage(e instanceof Error ? e.message : 'exchange_failed');
        setStatus('error');
      });
  }, [router]);

  if (status === 'error') {
    return (
      <main className="container mx-auto px-4 py-12 max-w-md">
        <h1 className="text-2xl font-bold mb-4">Sign-in failed</h1>
        <div
          data-testid="ms-callback-error"
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          <p className="font-medium">Could not complete Microsoft sign-in</p>
          <p className="mt-1">{errorMessage}</p>
          <p className="mt-3">
            <button
              type="button"
              onClick={() => router.push('/connect')}
              className="underline"
            >
              Try a different provider
            </button>
          </p>
        </div>
      </main>
    );
  }

  if (status === 'success') {
    return (
      <main
        className="container mx-auto px-4 py-12 max-w-md"
        data-testid="ms-callback-success"
      >
        <h1 className="text-2xl font-bold mb-4">Connected!</h1>
        <p className="text-slate-600">Microsoft account connected. Redirecting…</p>
      </main>
    );
  }

  // status === 'exchanging'
  return (
    <main
      className="container mx-auto px-4 py-12 max-w-md"
      data-testid="ms-callback-exchanging"
    >
      <h1 className="text-2xl font-bold mb-4">Completing sign-in…</h1>
      <p className="text-slate-600">Connecting your Microsoft account…</p>
    </main>
  );
}
