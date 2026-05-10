'use client';

/**
 * /connect/google/callback — handles redirect back from Google
 * (PRD §3.9, §5.2, §7.1, AINBOX-17).
 *
 * Supabase Auth's PKCE flow (detectSessionInUrl: true) auto-exchanges
 * the ?code= during client initialization — before our explicit
 * exchangeCodeForSession call. We subscribe to onAuthStateChange FIRST
 * so whichever path completes the exchange fires our token-save logic.
 *
 * Token persistence flow (§4.2):
 *   SIGNED_IN event with provider_refresh_token
 *     → POST /api/oauth/gmail/tokens (best-effort, never blocks redirect)
 *     → router.replace('/onboarding/sync')
 *
 * On error we surface a message and offer a retry link to /connect.
 */
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/client';

// OAuth callback — must render at runtime, not at build time
export const dynamic = 'force-dynamic';

type Status = 'pending' | 'error';

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={<div>Completing sign-in…</div>}>
      <GoogleCallbackInner />
    </Suspense>
  );
}

function GoogleCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string>('Completing sign-in…');

  useEffect(() => {
    let cancelled = false;

    const oauthError = params.get('error') || params.get('error_description');
    if (oauthError) {
      if (!cancelled) {
        setStatus('error');
        setMessage(oauthError);
      }
      return;
    }

    const supabase = getBrowserSupabase();
    const code = params.get('code');

    // Track whether SIGNED_IN fired (auto-exchange or explicit) so we know whether
    // a PKCE-verifier-missing error from our explicit call is a race artefact.
    let signedInHandled = false;

    /**
     * Save provider tokens server-side (encrypted) and redirect.
     * Called from the SIGNED_IN onAuthStateChange event — whichever code
     * path wins the PKCE exchange race triggers this exactly once.
     */
    async function onSignedIn(session: import('@supabase/supabase-js').Session | null) {
      signedInHandled = true;
      if (session?.provider_refresh_token) {
        try {
          await fetch('/api/oauth/gmail/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider_token: session.provider_token,
              provider_refresh_token: session.provider_refresh_token,
              expires_at: session.expires_at,
            }),
          });
        } catch {
          // Non-fatal: sync will surface a "connect your email" prompt.
        }
      }
      if (!cancelled) {
        router.replace('/onboarding/sync');
      }
    }

    // Subscribe BEFORE any exchange attempt so we capture the SIGNED_IN event
    // whether detectSessionInUrl or our explicit call wins the PKCE race.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (cancelled) return;
        if (event === 'SIGNED_IN') {
          await onSignedIn(session);
        }
      },
    );

    (async () => {
      try {
        if (code) {
          // Attempt explicit exchange. If detectSessionInUrl already handled it,
          // the verifier is gone and we get a PKCE error — but onAuthStateChange
          // already fired and redirect is in progress, so we suppress that error.
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            const isPkceRace =
              signedInHandled ||
              error.message?.toLowerCase().includes('pkce') ||
              error.message?.toLowerCase().includes('code verifier');
            if (!isPkceRace) {
              if (!cancelled) {
                setStatus('error');
                setMessage(error.message);
              }
            }
          }
          // On success: onAuthStateChange(SIGNED_IN) handles token save + redirect.
        } else {
          // Hash-fragment flow — getSession() resolves once SDK ingests #access_token,
          // or returns null if no session. Either way we redirect (no error → onboarding).
          const { data, error } = await supabase.auth.getSession();
          if (error) {
            if (!cancelled) {
              setStatus('error');
              setMessage(error.message);
            }
            return;
          }
          // If SIGNED_IN already fired (e.g. session existed), the subscription handles it.
          // If no session and SIGNED_IN hasn't fired, redirect unconditionally.
          if (!signedInHandled && !cancelled) {
            router.replace('/onboarding/sync');
          }
        }
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setMessage(e instanceof Error ? e.message : 'Callback handling failed');
        }
      }
    })();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [params, router]);

  return (
    <main className="container mx-auto px-4 py-12 max-w-md">
      <h1 className="text-2xl font-bold mb-4">Google sign-in</h1>
      {status === 'pending' ? (
        <p className="text-slate-600">{message}</p>
      ) : (
        <div role="alert" className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">Sign-in failed</p>
          <p className="mt-1">{message}</p>
          <p className="mt-3">
            <a className="underline" href="/connect">
              Try again
            </a>
          </p>
        </div>
      )}
    </main>
  );
}
