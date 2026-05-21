'use client';
/**
 * /connect — signup landing + provider chooser (PRD §5.2, §7.1, §7.2).
 *
 * Visual baseline: Fundely Framer template — orange wave hero, Inter Display
 * with Playfair serif italic accent, pill CTAs.
 */
import Link from 'next/link';
import { WaveBackground } from '@/components/brand/WaveBackground';
import { PillButton } from '@/components/brand/PillButton';
import { EyebrowChip } from '@/components/brand/EyebrowChip';

const FEATURES = [
  'Classify every inbound email in under a second',
  'Draft replies in your voice, learned from your sent mail',
  'Auto-send only above your confidence threshold — you stay in control',
];

export default function ConnectPage() {
  function go(path: string) {
    window.location.href = path;
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <WaveBackground variant="top" />

      {/* Top nav */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="flex items-center gap-2 font-display text-base font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-500 text-white text-xs">T</span>
          Task Response
        </Link>
        <Link
          href="/pricing"
          className="hidden text-sm text-muted hover:text-ink sm:inline"
        >
          Pricing
        </Link>
      </header>

      {/* Hero auth card */}
      <section className="relative z-10 mx-auto flex max-w-xl flex-col items-center px-6 pb-20 pt-10 text-center sm:pt-16">
        <EyebrowChip>14-day free trial · no card required</EyebrowChip>

        <h1 className="mt-6 font-display text-hero text-ink">
          Your inbox,
          <br />
          on <span className="font-serif italic text-brand-500">autopilot.</span>
        </h1>

        <p className="mt-6 max-w-md text-base leading-relaxed text-muted">
          Connect your Gmail or Microsoft 365 inbox and let Task Response
          classify, draft, and send safe replies — while you focus on work
          that matters.
        </p>

        {/* Provider buttons */}
        <div className="mt-10 flex w-full max-w-sm flex-col gap-3">
          <PillButton
            type="button"
            variant="primary"
            onClick={() => go('/connect/google')}
            aria-label="Continue with Google"
            className="w-full"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-white">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </PillButton>

          <PillButton
            type="button"
            variant="secondary"
            onClick={() => go('/connect/microsoft')}
            aria-label="Continue with Microsoft"
            className="w-full"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
              <path fill="#F25022" d="M1 1h10v10H1z" />
              <path fill="#7FBA00" d="M13 1h10v10H13z" />
              <path fill="#00A4EF" d="M1 13h10v10H1z" />
              <path fill="#FFB900" d="M13 13h10v10H13z" />
            </svg>
            Continue with Microsoft
          </PillButton>
        </div>

        {/* Feature reassurance row */}
        <ul className="mt-12 grid w-full max-w-md gap-3 text-left text-sm text-muted">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 flex-none rounded-full bg-brand-500" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <div className="mt-12 text-xs text-muted">
          <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
          <span className="mx-2">·</span>
          <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
          <span className="mx-2">·</span>
          <Link href="/security" className="hover:text-ink">Security</Link>
        </div>
      </section>
    </main>
  );
}
