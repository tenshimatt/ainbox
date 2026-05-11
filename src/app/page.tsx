/**
 * Marketing landing — Task Response.
 * Public surface. CTA → /connect kicks the OAuth → sync → onboarding flow.
 */
import Link from 'next/link';

export const metadata = {
  title: 'Task Response — AI inbox operations',
  description:
    'Task Response classifies, drafts, and auto-sends safe email replies for Gmail and Outlook.',
};

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-100">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <span className="text-lg font-semibold">Task Response</span>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#features" className="text-slate-600 hover:text-slate-900">Features</a>
            <a href="#how" className="text-slate-600 hover:text-slate-900">How it works</a>
            <Link href="/pricing" className="text-slate-600 hover:text-slate-900">Pricing</Link>
            <Link href="/connect" className="rounded-md bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live for Gmail &amp; Microsoft 365
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
            Your inbox, on autopilot.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600 sm:text-xl">
            Task Response reads, categorises, and drafts replies for every inbound email in
            your voice. You approve the borderline ones; the safe ones send themselves.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/connect" className="rounded-md bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
              Connect your inbox
            </Link>
            <a href="#how" className="text-sm font-semibold text-slate-700 hover:underline">
              How it works →
            </a>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            14-day free trial · No card required · 60-second setup
          </p>
        </div>
      </section>

      <section id="features" className="border-t border-slate-100 bg-slate-50/50 py-16">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 sm:grid-cols-3">
          {[
            { icon: '🎯', title: 'Classify every email', body: 'Sales, support, invoice, complaint, meeting — sorted in under a second with a confidence score.' },
            { icon: '✍️', title: 'Draft in your voice', body: 'Learns from your sent mail. Generates replies that match your tone, signature, and policies.' },
            { icon: '🛡️', title: 'Safe auto-send', body: 'Only above your confidence threshold (0.85 floor). 60-second cool-off. Full audit log. You stay in control.' },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-2xl">{f.icon}</div>
              <h3 className="mt-3 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">How it works</h2>
          <p className="mt-4 text-slate-600">Four steps. Two minutes.</p>
        </div>
        <ol className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: 1, t: 'Connect', d: 'Sign in with Google or Microsoft. We request read + draft + send scopes.' },
            { n: 2, t: 'Sync', d: 'Your last 1,000 emails import into your encrypted, tenant-isolated workspace.' },
            { n: 3, t: 'Learn', d: 'We extract KB items from your sent mail. You verify the ones we should reuse.' },
            { n: 4, t: 'Respond', d: 'New mail arrives → classify → draft → auto-send if confidence ≥ your threshold.' },
          ].map((s) => (
            <li key={s.n} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                {s.n}
              </div>
              <h3 className="mt-3 text-base font-semibold">{s.t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-slate-100 bg-slate-900 py-16 text-white">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">Stop typing the same reply twice.</h2>
          <p className="mt-4 text-slate-300">
            Connect your inbox in 60 seconds. First drafts in your queue inside 2 minutes.
          </p>
          <Link href="/connect" className="mt-8 inline-block rounded-md bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">
            Connect your inbox →
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-100 py-10 text-sm text-slate-500">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 sm:flex-row">
          <span>© 2026 Task Response.</span>
          <div className="flex gap-5">
            <Link href="/pricing" className="hover:text-slate-700">Pricing</Link>
            <Link href="/security" className="hover:text-slate-700">Security</Link>
            <Link href="/legal/privacy" className="hover:text-slate-700">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-slate-700">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
