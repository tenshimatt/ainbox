'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const SYNC_STEPS = [
  { id: 'connecting', label: 'Connecting to provider' },
  { id: 'fetching', label: 'Fetching email metadata' },
  { id: 'classifying', label: 'Classifying emails' },
  { id: 'extracting', label: 'Extracting knowledge' },
  { id: 'complete', label: 'Sync complete' },
];

export default function SyncPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [syncStatus, setSyncStatus] = useState<'in-progress' | 'complete'>('in-progress');
  const [batchEvents, setBatchEvents] = useState<string[]>([]);

  useEffect(() => {
    // Simulate sync progress
    const intervals = [
      { step: 1, delay: 600, msg: 'Connected to Gmail — fetching messages...' },
      { step: 2, delay: 1400, msg: 'Fetched 500 emails (batch 1/4)...' },
      { step: 2, delay: 2200, msg: 'Fetched 1,000 emails (batch 2/4)...' },
      { step: 2, delay: 3000, msg: 'Connected to Outlook — fetching messages...' },
      { step: 2, delay: 3800, msg: 'Fetched 300 emails (batch 1/2)...' },
      { step: 3, delay: 4600, msg: 'Classifying emails...' },
      { step: 3, delay: 5400, msg: 'Classified 800 emails across 10 categories' },
      { step: 4, delay: 6200, msg: 'Extracting knowledge base items...' },
      { step: 4, delay: 7000, msg: 'Extracted 12 KB items from email history' },
      { step: 5, delay: 7800, msg: 'Sync complete!' },
    ];

    const timers: ReturnType<typeof setTimeout>[] = [];

    intervals.forEach(({ step, delay, msg }) => {
      const timer = setTimeout(() => {
        setCurrentStep(step);
        setProgress(Math.round((step / SYNC_STEPS.length) * 100));
        setBatchEvents((prev) => [...prev, msg]);
        if (step === SYNC_STEPS.length) {
          setSyncStatus('complete');
        }
      }, delay);
      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-12 sm:px-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">Syncing your email</h1>
          <p className="mt-2 text-sm text-slate-500">
            We're pulling your recent emails to build your knowledge base
          </p>
        </div>

        {/* Progress bar */}
        <div className="mt-10" data-testid="sync-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              {syncStatus === 'complete' ? 'Sync complete' : `${progress}% complete`}
            </span>
            <span className="text-slate-500">{progress}%</span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                syncStatus === 'complete' ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="mt-8 space-y-4">
          {SYNC_STEPS.map((step, idx) => (
            <div
              key={step.id}
              className={`flex items-center gap-3 rounded-lg border bg-white p-3 transition-colors ${
                idx < currentStep
                  ? 'border-green-200'
                  : idx === currentStep
                  ? 'border-blue-200'
                  : 'border-slate-200 opacity-50'
              }`}
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  idx < currentStep
                    ? 'bg-green-100 text-green-700'
                    : idx === currentStep
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                {idx < currentStep ? '✓' : idx + 1}
              </div>
              <span
                className={`text-sm ${
                  idx < currentStep
                    ? 'text-green-700'
                    : idx === currentStep
                    ? 'text-blue-700'
                    : 'text-slate-400'
                }`}
              >
                {step.label}
              </span>
              {idx === currentStep && syncStatus === 'in-progress' && (
                <svg className="ml-auto h-4 w-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {idx < currentStep && (
                <span className="ml-auto text-xs text-green-600">Done</span>
              )}
            </div>
          ))}
        </div>

        {/* Batch events */}
        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Sync events
          </h3>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {batchEvents.map((event, idx) => (
              <p key={idx} className="text-xs text-slate-600">
                {event}
              </p>
            ))}
            {syncStatus === 'in-progress' && batchEvents.length === 0 && (
              <p className="text-xs text-slate-400">Waiting to start...</p>
            )}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-8 text-center">
          {syncStatus === 'complete' ? (
            <Link
              href="/onboarding/kb-review"
              className="inline-block rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Continue to Knowledge Review
            </Link>
          ) : (
            <button
              disabled
              className="inline-block rounded-lg bg-slate-300 px-6 py-2.5 text-sm font-medium text-slate-500 cursor-not-allowed"
            >
              Syncing...
            </button>
          )}
          {/* Always-present finish CTA for structural tests (§7.16) */}
          <div className="mt-4">
            <Link
              href="/inbox"
              className={`text-sm underline ${syncStatus === 'complete' ? 'text-slate-700' : 'text-slate-300 pointer-events-none'}`}
            >
              Go to Inbox
            </Link>
          </div>
        </div>

        {/* Back / retry navigation (§7.17) */}
        <div className="mt-4 text-center">
          <Link
            href="/connect/providers"
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Back to Connect
          </Link>
        </div>
      </div>
    </main>
  );
}
