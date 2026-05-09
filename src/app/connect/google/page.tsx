'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ConnectGooglePage() {
  const router = useRouter();
  const [status, setStatus] = useState('Preparing Google OAuth redirect...');

  useEffect(() => {
    // Simulate OAuth initiation
    const timer = setTimeout(() => {
      // In production, this would redirect to Google's OAuth URL
      // For now, simulate a redirect flow
      window.location.href = '/connect/google/callback?state=test_state';
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500">
          <svg className="h-5 w-5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-slate-900">Connecting Google...</h1>
        <p className="mt-2 text-sm text-slate-500">{status}</p>
      </div>
    </main>
  );
}
