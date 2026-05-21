/**
 * Shared chrome (nav + footer) for public-facing pages other than the landing.
 * Keeps the Fundely visual baseline consistent across /pricing, /security,
 * /legal/*. The landing page uses its own bespoke hero treatment.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PillLink } from './PillButton';

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen bg-white text-ink">
      <header className="border-b border-ink/5">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2 font-display text-base font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-500 text-white text-xs">T</span>
            Task Response
          </Link>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
            <Link href="/security" className="hover:text-ink">Security</Link>
            <PillLink href="/connect" variant="primary" className="px-5 py-2 text-sm">
              Sign in
            </PillLink>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-ink/5 py-10 text-sm text-muted">
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
