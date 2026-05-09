'use client';

/**
 * PRD §5.2 Onboarding — `/connect/microsoft/callback` lands the OAuth code
 * PRD §7.2 Provider OAuth — Microsoft
 * PRD §4.2 OAuth token storage — Supabase exchanges the code, persists the
 *          session, and (server-side) routes the refresh token into the
 *          encrypted `oauth_tokens` table. This client page never touches
 *          tokens directly.
 *
 * Happy path: code present, exchange ok → push user to /onboarding/sync.
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
      const result = await completeMicrosoftOAuth(code);
      if (cancelled) return;
      if (result.ok) {
        setStatus('success');
        router.replace('/onboarding/sync');
      } else {
        setErrorMessage(result.error);
        setStatus('error');
      }
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
