/**
 * Small pill chip that sits above a hero heading — the "Empower your financial
 * growth" element from the Fundely baseline. White bg, hairline border, ink
 * text, small leading dot in brand orange.
 */
import type { ReactNode } from 'react';

export function EyebrowChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-ink/10 bg-white/80 px-3 py-1 text-xs font-medium text-ink shadow-sm backdrop-blur">
      <span className="block h-1.5 w-1.5 rounded-full bg-brand-500" />
      {children}
    </span>
  );
}
