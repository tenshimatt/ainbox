/**
 * OnboardingProgress — compact sidebar widget showing setup completion.
 * Fetches /api/onboarding/status on mount; hides itself once all steps are done.
 * PRD: §TASK7544-16
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface OnboardingStatus {
  synced: boolean;
  kbReviewed: boolean;
}

const STEPS: { label: string; href: string; key: keyof OnboardingStatus }[] = [
  { label: 'Sync email',            href: '/onboarding/sync',      key: 'synced' },
  { label: 'Review knowledge base', href: '/onboarding/kb-review', key: 'kbReviewed' },
];

export function OnboardingProgress() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    fetch('/api/onboarding/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setStatus({ synced: Boolean(data.synced), kbReviewed: Boolean(data.kbReviewed) });
        }
      })
      .catch(() => {
        /* silent — sidebar widget is non-critical */
      });
  }, []);

  if (!status) return null;

  const completedCount = STEPS.filter((s) => status[s.key]).length;
  if (completedCount === STEPS.length) return null;

  const progressPct = Math.round((completedCount / STEPS.length) * 100);

  return (
    <div
      className="mx-3 mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3"
      data-testid="sidebar-onboarding-progress"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Setup
      </p>

      {/* Progress bar */}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Onboarding progress"
      >
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${progressPct}%` }}
          data-testid="sidebar-onboarding-progress-bar"
        />
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {completedCount} of {STEPS.length} complete
      </p>

      {/* Step list */}
      <ul className="mt-2 space-y-1.5">
        {STEPS.map((step, idx) => {
          const done = status[step.key];
          return (
            <li key={step.href}>
              <Link
                href={step.href}
                className={`flex items-center gap-2 text-xs ${
                  done
                    ? 'pointer-events-none text-slate-400'
                    : 'text-blue-600 hover:underline'
                }`}
                data-testid={`sidebar-onboarding-step-${idx + 1}`}
                aria-current={!done ? 'step' : undefined}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                    done ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'
                  }`}
                >
                  {done ? '✓' : idx + 1}
                </span>
                <span className="truncate">{step.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
