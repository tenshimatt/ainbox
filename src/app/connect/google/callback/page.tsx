'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';

function GoogleCallbackInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('Exchanging authorization code...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code) {
      setError('No authorization code received. Please try connecting again.');
      return;
    }

    // Simulate code exchange
    const timer = setTimeout(() => {
      // In production, this POSTs to the backend which exchanges the code
      // For now, redirect to sync onboarding
      router.push('/onboarding/sync');
    }, 1500);

    return () => clearTimeout(timer);
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <span className="text-xl text-red-600">!</span>
        </div>
        <h1 className="text-xl font-semibold text-slate-900">Connection Failed</h1>
        <p className="mt-2 text-sm text-red-600">{error}</p>
        <button
          onClick={() => router.push('/connect')}
          className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm text-center">
      <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full border-2 border-green-500">
        <span className="text-xl text-green-600">✓</span>
      </div>
      <h1 className="text-xl font-semibold text-slate-900">Google Connected</h1>
      <p className="mt-2 text-sm text-slate-500">{status}</p>
      <div className="mt-6">
        <div className="mx-auto h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-200">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-green-500" />
        </div>
      </div>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <Suspense fallback={
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full border-2 border-green-500">
            <svg className="h-5 w-5 animate-spin text-green-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Processing...</h1>
        </div>
      }>
        <GoogleCallbackInner />
      </Suspense>
    </main>
  );
}
