/**
 * Marketing landing — Task Response. Visual baseline: Fundely Framer template.
 * Public surface. CTA → /connect kicks the OAuth → sync → onboarding flow.
 */
import Link from 'next/link';
import { WaveBackground } from '@/components/brand/WaveBackground';
import { PillLink } from '@/components/brand/PillButton';
import { EyebrowChip } from '@/components/brand/EyebrowChip';

export const metadata = {
  title: 'Task Response — Your inbox, on autopilot',
  description:
    'Task Response classifies, drafts, and auto-sends safe email replies for Gmail and Microsoft 365.',
};

const FEATURES = [
  {
    title: 'Classify every email',
    body: 'Sales, support, invoice, complaint, meeting — sorted in under a second with a confidence score.',
  },
  {
    title: 'Draft in your voice',
    body: 'Learns from your sent mail. Generates replies that match your tone, signature, and policies.',
  },
  {
    title: 'Safe auto-send',
    body: 'Only above your confidence threshold. 60-second cool-off. Full audit log. You stay in control.',
  },
];

const STEPS = [
  { n: 1, t: 'Connect', d: 'Sign in with Google or Microsoft. We request read + draft + send scopes.' },
  { n: 2, t: 'Sync',    d: 'Your last 1,000 emails import into your encrypted, tenant-isolated workspace.' },
  { n: 3, t: 'Learn',   d: 'We extract KB items from your sent mail. You verify the ones we should reuse.' },
  { n: 4, t: 'Respond', d: 'New mail arrives → classify → draft → auto-send if confidence ≥ your threshold.' },
];

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative">
        <WaveBackground variant="top" />
        <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2 font-display text-base font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-500 text-white text-xs">T</span>
            Task Response
          </Link>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#how" className="hover:text-ink">How it works</a>
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
            <PillLink href="/connect" variant="primary" className="px-5 py-2 text-sm">
              Sign in
            </PillLink>
          </nav>
        </header>

        <div className="relative z-10 mx-auto max-w-3xl px-6 pt-12 pb-28 text-center sm:pt-20 sm:pb-36">
          <EyebrowChip>Live for Gmail &amp; Microsoft 365</EyebrowChip>
          <h1 className="mt-6 font-display text-hero text-ink sm:text-[5rem] sm:leading-[1]">
            Your inbox,
            <br />
            on <span className="font-serif italic text-brand-500">autopilot.</span>
          </h1>
          <p className="mt-8 text-lg leading-relaxed text-muted">
            Task Response reads, categorises, and drafts replies for every inbound email in
            your voice. You approve the borderline ones; the safe ones send themselves.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <PillLink href="/connect" variant="primary">Connect your inbox</PillLink>
            <PillLink href="#how" variant="tertiary">How it works</PillLink>
          </div>
          <p className="mt-5 text-xs text-muted">
            14-day free trial · No card required · 60-second setup
          </p>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section id="features" className="bg-white py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-display text-ink">
              Everything you{' '}
              <span className="font-serif italic text-brand-500">need</span> to
              <br />
              tame your inbox.
            </h2>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-3xl bg-surface p-8 shadow-card"
              >
                <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-500 text-white text-base">●</div>
                <h3 className="mt-5 font-display text-title text-ink">{f.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────── */}
      <section id="how" className="bg-ink py-24 text-white">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-display">
              Four steps.{' '}
              <span className="font-serif italic text-brand-500">Two minutes.</span>
            </h2>
          </div>
          <ol className="mx-auto mt-14 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-500 text-sm font-semibold">
                  {s.n}
                </div>
                <h3 className="mt-4 font-display text-base font-medium">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Final CTA with bottom wave ─────────────────────────── */}
      <section className="relative overflow-hidden">
        <WaveBackground variant="bottom" />
        <div className="relative z-10 mx-auto max-w-2xl px-6 py-28 text-center">
          <h2 className="font-display text-display text-ink">
            Stop typing the same{' '}
            <span className="font-serif italic text-brand-500">reply</span> twice.
          </h2>
          <p className="mt-5 text-base text-muted">
            Connect your inbox in 60 seconds. First drafts in your queue inside 2 minutes.
          </p>
          <div className="mt-8">
            <PillLink href="/connect" variant="primary">Connect your inbox</PillLink>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink/5 bg-white py-10 text-sm text-muted">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 sm:flex-row">
          <span>© 2026 Task Response.</span>
          <div className="flex gap-5">
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
            <Link href="/security" className="hover:text-ink">Security</Link>
            <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
