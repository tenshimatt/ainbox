'use client';

/**
 * /onboarding/wait — rotating carousel waiting screen shown while
 * email sync runs in the background. Replaces /onboarding/sync.
 * TASK7544-23
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { OnboardingStepper } from '@/components/onboarding/OnboardingStepper';

const SLIDES = [
  {
    id: 'intro',
    headline: 'Your inbox, handled.',
    body: 'Ainbox drafts replies based on your own email history. The more you use it, the better it gets.',
    icon: '✉️',
  },
  {
    id: 'knowledge',
    headline: 'Knowledge extracted from your emails',
    body: 'We pull FAQs, pricing, and preferences from your sent mail — so AI replies sound exactly like you.',
    icon: '🧠',
  },
  {
    id: 'control',
    headline: "You're always in control",
    body: 'Nothing is ever sent without your approval. Review every draft before it goes.',
    icon: '🔒',
  },
  {
    id: 'confidence',
    headline: 'Confidence scores keep you informed',
    body: 'Each draft shows a confidence score. High scores mean the AI is sure — low scores flag for your attention.',
    icon: '📊',
  },
  {
    id: 'time',
    headline: 'Sync takes 1–3 minutes',
    body: "We're fetching and classifying your recent emails. This only happens once — future syncs are incremental.",
    icon: '⏱️',
  },
] as const;

const SLIDE_DURATION_MS = 4000;

type SyncStatus = 'in-progress' | 'complete';
type Counts = { synced: number; classified: number; drafts: number; kb: number };

export default function WaitPage() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('in-progress');
  const [progress, setProgress] = useState(0);
  const [batchEvents, setBatchEvents] = useState<string[]>([]);

  // ── Carousel auto-advance ──────────────────────────────────────────────────
  useEffect(() => {
    if (syncStatus === 'complete') return;
    const id = setInterval(() => {
      setActiveSlide((s) => (s + 1) % SLIDES.length);
    }, SLIDE_DURATION_MS);
    return () => clearInterval(id);
  }, [syncStatus]);

  const goTo = useCallback((idx: number) => {
    setActiveSlide(idx);
  }, []);

  const goPrev = useCallback(() => {
    setActiveSlide((s) => (s - 1 + SLIDES.length) % SLIDES.length);
  }, []);

  const goNext = useCallback(() => {
    setActiveSlide((s) => (s + 1) % SLIDES.length);
  }, []);

  // ── Background sync (same logic as the old /onboarding/sync page) ──────────
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function runSync() {
      setBatchEvents((p) => [...p, 'Detecting connected providers…']);

      const providers: Array<{ slug: 'gmail' | 'outlook'; label: string }> = [
        { slug: 'gmail',   label: 'Gmail' },
        { slug: 'outlook', label: 'Outlook' },
      ];

      let started = false;
      for (const p of providers) {
        try {
          const r = await fetch(`/api/sync/${p.slug}`, {
            method: 'POST',
            credentials: 'same-origin',
          });
          if (cancelled) return;
          if (r.ok) {
            setBatchEvents((q) => [...q, `${p.label} backfill started.`]);
            started = true;
            break;
          }
          const body = (await r.json().catch(() => ({}))) as {
            error?: string;
            detail?: string;
          };
          if (
            !/no\s+(gmail|outlook|provider)\s+oauth\s+token|run\s+\/connect|missing\s+token/i.test(
              body.error ?? '',
            )
          ) {
            const detail = body.detail ? ` — ${body.detail.slice(0, 200)}` : '';
            setBatchEvents((q) => [
              ...q,
              `${p.label} skipped: ${body.error ?? r.statusText}${detail}`,
            ]);
          }
        } catch (err) {
          setBatchEvents((q) => [
            ...q,
            `${p.label} request failed: ${(err as Error).message}`,
          ]);
        }
      }

      if (!started) {
        setBatchEvents((q) => [
          ...q,
          'No mailbox connected. Go to /connect and link Google or Microsoft.',
        ]);
        return;
      }

      try {
        setBatchEvents((p) => [...p, 'Backfill running — fetching messages…']);

        let lastCount = 0;
        let stableTicks = 0;
        pollTimer = setInterval(async () => {
          if (cancelled) return;
          try {
            const r = await fetch('/api/sync/status', {
              credentials: 'same-origin',
            });
            if (!r.ok) return;
            const { counts: c } = (await r.json()) as { counts: Counts };

            if (c.synced > lastCount) {
              setBatchEvents((p) => [
                ...p,
                `Synced ${c.synced} messages so far…`,
              ]);
              setProgress(Math.min(80, 20 + Math.floor(c.synced / 10)));
              lastCount = c.synced;
              stableTicks = 0;
            } else {
              stableTicks++;
            }

            if (stableTicks >= 3 && lastCount > 0) {
              setProgress(100);
              setSyncStatus('complete');
              setBatchEvents((p) => [
                ...p,
                `Sync complete — ${lastCount} messages.`,
              ]);
              if (pollTimer) clearInterval(pollTimer);
            }
          } catch {
            /* keep polling */
          }
        }, 4000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        setBatchEvents((p) => [...p, `Sync failed: ${msg}`]);
      }
    }

    runSync();
    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  const slide = SLIDES[activeSlide];

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-12 sm:px-6">
        <OnboardingStepper currentStep={1} />

        {/* Thin progress bar at top of card area */}
        <div
          className="mb-6 h-1 w-full overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Sync progress"
          data-testid="wait-progress-bar"
        >
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              syncStatus === 'complete' ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progress}%` }}
            data-testid="wait-progress-fill"
          />
        </div>

        {/* ── Carousel card ───────────────────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          data-testid="wait-carousel"
          aria-roledescription="carousel"
          aria-label="While you wait"
        >
          {/* Slide */}
          <div
            className="flex flex-col items-center px-8 py-12 text-center"
            data-testid={`wait-slide-${slide.id}`}
            role="group"
            aria-roledescription="slide"
            aria-label={slide.headline}
          >
            <div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-4xl"
              aria-hidden="true"
            >
              {slide.icon}
            </div>
            <h2
              className="text-xl font-bold text-slate-900 sm:text-2xl"
              data-testid="wait-slide-headline"
            >
              {slide.headline}
            </h2>
            <p
              className="mt-3 text-sm leading-relaxed text-slate-500"
              data-testid="wait-slide-body"
            >
              {slide.body}
            </p>
          </div>

          {/* Prev / Next arrow buttons */}
          <button
            onClick={goPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white p-2 shadow hover:bg-slate-50"
            aria-label="Previous slide"
            data-testid="wait-prev"
          >
            <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            onClick={goNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white p-2 shadow hover:bg-slate-50"
            aria-label="Next slide"
            data-testid="wait-next"
          >
            <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Dot indicators */}
        <div
          className="mt-5 flex items-center justify-center gap-2"
          role="tablist"
          aria-label="Slide navigation"
          data-testid="wait-dots"
        >
          {SLIDES.map((s, idx) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={idx === activeSlide}
              aria-label={`Slide ${idx + 1}: ${s.headline}`}
              onClick={() => goTo(idx)}
              data-testid={`wait-dot-${idx}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                idx === activeSlide
                  ? 'w-6 bg-blue-500'
                  : 'w-2 bg-slate-300 hover:bg-slate-400'
              }`}
            />
          ))}
        </div>

        {/* Status line */}
        <p
          className="mt-6 text-center text-xs text-slate-400"
          data-testid="wait-status-line"
        >
          {syncStatus === 'complete'
            ? `Sync complete — ${batchEvents.filter((e) => e.startsWith('Sync complete')).length ? batchEvents[batchEvents.length - 1] : 'ready'}`
            : 'Syncing your email in the background…'}
        </p>

        {/* CTA */}
        <div className="mt-8 text-center" data-testid="wait-cta">
          {syncStatus === 'complete' ? (
            <Link
              href="/onboarding/kb-review"
              className="inline-block rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
              data-testid="wait-continue-link"
            >
              Continue to Knowledge Review
            </Link>
          ) : (
            <button
              disabled
              className="inline-block cursor-not-allowed rounded-lg bg-slate-300 px-6 py-2.5 text-sm font-medium text-slate-500"
              data-testid="wait-syncing-button"
            >
              Syncing…
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
