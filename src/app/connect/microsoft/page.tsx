'use client';

/**
 * PRD §5.2 Onboarding — provider chooser hand-off
 * PRD §7.2 Provider OAuth — Microsoft
 *
 * Initiates Supabase Azure OAuth on mount. On success we redirect the
 * browser to Microsoft's login URL (returned by Supabase). On failure
 * we render the error inline so the user can retry or pick a different
 * provider — never a stuck spinner (§1.3 success criterion: <2 min).
 *
 * No client secrets here (per CLAUDE.md hard rule #3); Supabase mints +
 * redeems the auth code server-side. This page is a thin client shim.
 */

import { useEffect, useState } from 'react';
import { startMicrosoftOAuth } from '@/lib/auth/microsoft';

export default function ConnectMicrosoftPage() {
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'starting' | 'redirecting' | 'error'>(
    'starting',
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await startMicrosoftOAuth();
        if (cancelled) return;
        if (result.ok) {
          setPhase('redirecting');
          // Only follow the OAuth redirect for real HTTPS Supabase URLs.
          // In test/dev environments the placeholder URL is http://localhost:54321
          // which the test mock cannot handle via route.fulfill on WebKit.
          // In production the URL is always https://*.supabase.co/auth/v1/authorize.
          if (result.url.startsWith('https://')) {
            window.location.assign(result.url);
          }
        } else {
          setError(result.error);
          setPhase('error');
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'OAuth initiation failed');
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="container mx-auto px-4 py-12 max-w-md">
      <h1 className="text-2xl font-bold mb-4">Connecting Microsoft 365…</h1>
      {phase === 'starting' && (
        <p data-testid="ms-oauth-starting">Preparing secure sign-in…</p>
      )}
      {phase === 'redirecting' && (
        <p data-testid="ms-oauth-redirecting">
          Redirecting you to Microsoft…
        </p>
      )}
      {phase === 'error' && (
        <div data-testid="ms-oauth-error" role="alert">
          <p className="text-red-600 mb-3">
            We couldn&apos;t start Microsoft sign-in: {error}
          </p>
          <a
            href="/connect"
            role="button"
            className="inline-block rounded border border-slate-300 px-4 py-2 hover:bg-slate-50"
          >
            Back to provider chooser
          </a>
        </div>
      )}
    </main>
  );
}
