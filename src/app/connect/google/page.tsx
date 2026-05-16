'use client';

/**
 * /connect/google — initiates Supabase Auth OAuth with Google
 * (PRD §3.9, §7.1, §4.2).
 *
 * Runs on mount: builds the Google OAuth URL via Supabase Auth
 * (with Gmail email-scope tokens included) and navigates the browser
 * to accounts.google.com. The Playwright e2e spec asserts on either
 * the `accounts.google.com` URL or the local `/connect/google` URL,
 * so a graceful failure to /connect with an error toast is acceptable.
 */
import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { startGoogleOAuth } from '@/lib/auth/google';

export default function GoogleConnectPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getBrowserSupabase();

        // Skip re-auth if the user already has a valid session with a gmail token.
        // getSession() reads from localStorage without a network round-trip;
        // server-side token validation is handled by the middleware on /inbox.
        const { data: { session } } = await supabase.auth.getSession();
        if (!cancelled && session?.user) {
          const resp = await fetch('/api/oauth/tokens');
          if (!cancelled && resp.ok) {
            const json = await resp.json();
            const hasGmail = (json.providers ?? []).some(
              (p: { id: string }) => p.id === 'gmail',
            );
            if (hasGmail) {
              window.location.assign('/inbox');
              return;
            }
          }
        }

        if (cancelled) return;
        const origin = window.location.origin;
        const { url, error } = await startGoogleOAuth(supabase, origin);
        if (cancelled) return;
        if (error) {
          setError(error);
          return;
        }
        if (url) {
          window.location.assign(url);
        } else {
          setError('No OAuth URL returned by Supabase');
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'OAuth initiation failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="container mx-auto px-4 py-12 max-w-md">
      <h1 className="text-2xl font-bold mb-4">Connecting Google…</h1>
      {error ? (
        <div role="alert" className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">Could not start Google sign-in</p>
          <p className="mt-1">{error}</p>
          <p className="mt-3">
            <a className="underline" href="/connect">
              Back to provider chooser
            </a>
          </p>
        </div>
      ) : (
        <p className="text-slate-600">Redirecting to Google…</p>
      )}
    </main>
  );
}
