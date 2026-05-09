'use client';

/**
 * /connect/google/callback — handles redirect back from Google
 * (PRD §3.9, §5.2, §7.1).
 *
 * Supabase Auth's PKCE flow returns either:
 *   - `?code=…` (auth-code) which we exchange for a session, OR
 *   - `#access_token=…` (implicit / hash) handled automatically by detectSessionInUrl
 *   - `?error=…` from a denied consent
 *
 * On success we navigate to /onboarding/sync (PRD §5.2). On error we
 * surface a message and offer a retry link to /connect.
 */
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/client';

type Status = 'pending' | 'error';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string>('Completing sign-in…');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const oauthError = params.get('error') || params.get('error_description');
      if (oauthError) {
        if (!cancelled) {
          setStatus('error');
          setMessage(oauthError);
        }
        return;
      }

      try {
        const supabase = getBrowserSupabase();
        const code = params.get('code');

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            if (!cancelled) {
              setStatus('error');
              setMessage(error.message);
            }
            return;
          }
        } else {
          // Hash-fragment flow — getSession() resolves once SDK ingests #access_token.
          const { error } = await supabase.auth.getSession();
          if (error) {
            if (!cancelled) {
              setStatus('error');
              setMessage(error.message);
            }
            return;
          }
        }

        if (!cancelled) {
          router.replace('/onboarding/sync');
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
