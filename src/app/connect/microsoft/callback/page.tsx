'use client';

/**
 * PRD §5.2 Onboarding — `/connect/microsoft/callback` lands the OAuth code
 * PRD §7.2 Provider OAuth — Microsoft
 * PRD §4.2 OAuth token storage — Supabase exchanges the code server-side.
 *          After exchange this page calls POST /api/oauth/microsoft/store-tokens
 *          to persist the encrypted refresh token (AINBOX-18).
 *
 * Happy path: code present → exchange → store tokens → push to /onboarding/sync.
 * Deny / error: surface the message + a recovery link back to /connect.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { completeMicrosoftOAuth } from '@/lib/auth/microsoft';

// OAuth callback — must render at runtime, not at build time
export const dynamic = 'force-dynamic';

export default function MicrosoftCallbackPage() {
  return (
    <Suspense fallback={<div>Completing sign-in…</div>}>
      <MicrosoftCallbackInner />
    </Suspense>
  );
}

function MicrosoftCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<'exchanging' | 'success' | 'error'>(
    'exchanging',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // OAuth deny / provider error returns ?error=access_denied&error_description=…
    const oauthError = params.get('error');
    const oauthDesc = params.get('error_description');
    if (oauthError) {
      setErrorMessage(oauthDesc || oauthError);
      setStatus('error');
      return;
    }

    const code = params.get('code');
    if (!code) {
      setErrorMessage('missing_code');
      setStatus('error');
      return;
    }

    (async () => {
      // Step 1: Exchange the auth code for a Supabase session (mints
      // provider_token + provider_refresh_token in the session).
      const result = await completeMicrosoftOAuth(code);
      if (cancelled) return;
      if (!result.ok) {
        setErrorMessage(result.error);
        setStatus('error');
        return;
      }

      // Step 2: Persist the Microsoft refresh token server-side (AINBOX-18).
      // The route extracts provider_refresh_token from the active session,
      // encrypts it via AINBOX-5 crypto, and upserts into oauth_tokens.
      let storeOk = true;
      let storeError: string | null = null;
      try {
        const storeRes = await fetch('/api/oauth/microsoft/store-tokens', {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!storeRes.ok) {
          const body = await storeRes.json().catch(() => ({})) as { error?: string };
          storeError = body.error ?? 'token_storage_failed';
          storeOk = false;
        }
      } catch {
        storeError = 'token_storage_network_error';
        storeOk = false;
      }

      if (cancelled) return;

      if (!storeOk) {
        setErrorMessage(storeError);
        setStatus('error');
        return;
      }

      setStatus('success');
      router.replace('/onboarding/sync');
    })();

    return () => {
      cancelled = true;
    };
  }, [params, router]);

  return (
    <main className="container mx-auto px-4 py-12 max-w-md">
      <h1 className="text-2xl font-bold mb-4">Microsoft sign-in</h1>
      {status === 'exchanging' && (
        <p data-testid="ms-callback-exchanging">
          Finalising your secure connection…
        </p>
      )}
      {status === 'success' && (
        <p data-testid="ms-callback-success">
          Connected. Taking you to email sync…{' '}
          <a href="/onboarding/sync" className="underline">
            Continue
          </a>
        </p>
      )}
      {status === 'error' && (
        <div data-testid="ms-callback-error" role="alert">
          <p className="text-red-600 mb-3">
            Microsoft sign-in did not complete: {errorMessage}
          </p>
          <a
            href="/connect"
            role="button"
            className="inline-block rounded border border-slate-300 px-4 py-2 hover:bg-slate-50"
          >
            Try a different provider
          </a>
        </div>
      )}
    </main>
  );
}
