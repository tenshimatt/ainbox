'use client';
/**
 * /connect — signup landing + provider chooser (PRD §5.2, §7.1, §7.2).
 *
 * Rawgle visual pattern: split-panel layout — brand/hero on the left,
 * auth card on the right. Stacks to single column on mobile (375 px floor).
 *
 * Uses window.location.href for provider navigation (hard navigation)
 * to ensure the provider page is loaded in a fresh document context.
 * This is required because:
 *   1. Mobile WebKit does not fire click events on <a role="button"> for
 *      native link following (resolved by using a JS click handler).
 *   2. The Supabase OAuth redirect (window.location.assign) inside the
 *      provider page must happen in a hard-navigation context so that
 *      Playwright's page.route() can handle the subsequent document
 *      navigation correctly (soft-nav context breaks route.fulfill
 *      for redirect status codes in Playwright ≥ 1.46).
 */
import Link from 'next/link';

const FEATURES = [
  { icon: '🎯', label: 'Classify every inbound email in under a second' },
  { icon: '✍️', label: 'Draft replies in your voice, learned from your sent mail' },
  { icon: '🛡️', label: 'Auto-send only above your confidence threshold — you stay in control' },
];

export default function ConnectPage() {
  function go(path: string) {
    window.location.href = path;
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col sm:flex-row">
      {/* ── Left panel: brand + value prop (hidden below sm) ── */}
      <div className="hidden sm:flex sm:w-1/2 lg:w-3/5 bg-slate-900 text-white flex-col justify-between p-10 lg:p-16">
        <div>
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Task Response
          </Link>
        </div>

        <div>
          <h1 className="text-3xl lg:text-4xl font-bold leading-snug">
            Your inbox,<br />on autopilot.
          </h1>
          <p className="mt-4 text-slate-300 text-base leading-relaxed max-w-sm">
            Connect your Gmail or Microsoft 365 inbox and let Task Response
            classify, draft, and send safe replies — while you focus on work
            that matters.
          </p>

          <ul className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.label} className="flex items-start gap-3 text-sm text-slate-300">
                <span className="mt-0.5 text-base leading-none">{f.icon}</span>
                <span>{f.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-500">
          © 2026 Task Response. All rights reserved.
        </p>
      </div>

      {/* ── Right panel: auth card ── */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 sm:px-10">
        {/* Mobile-only wordmark */}
        <div className="mb-8 sm:hidden">
          <Link href="/" className="text-xl font-semibold tracking-tight">
            Task Response
          </Link>
        </div>

        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold">Connect your inbox</h2>
          <p className="mt-2 text-sm text-slate-600">
            Sign in with your inbox provider. We request mail-read, mail-modify,
            and mail-send scopes so Task Response can draft and send replies on
            your behalf.
          </p>

          <div className="mt-8 space-y-3">
            <button
              type="button"
              onClick={() => go('/connect/google')}
              aria-label="Continue with Google"
              className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {/* Google "G" mark — inline SVG, no external asset */}
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-white">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              onClick={() => go('/connect/microsoft')}
              aria-label="Continue with Microsoft"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
            >
              {/* Microsoft "⊞" mark — inline SVG */}
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                <path fill="#F25022" d="M1 1h10v10H1z" />
                <path fill="#7FBA00" d="M13 1h10v10H13z" />
                <path fill="#00A4EF" d="M1 13h10v10H1z" />
                <path fill="#FFB900" d="M13 13h10v10H13z" />
              </svg>
              Continue with Microsoft
            </button>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            14-day free trial · No card required · 60-second setup
          </p>

          <div className="mt-8 border-t border-slate-100 pt-6 text-center text-xs text-slate-400 space-x-3">
            <Link href="/legal/privacy" className="hover:text-slate-600">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-slate-600">Terms</Link>
            <Link href="/security" className="hover:text-slate-600">Security</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
