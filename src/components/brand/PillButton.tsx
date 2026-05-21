/**
 * Pill button matching the Fundely Framer baseline:
 *  - primary:   orange #FF4F01 bg, white text
 *  - secondary: ink #060606 bg, white text
 *  - tertiary:  surface #F7F7F8 bg, ink text
 *  - ghost:     transparent bg, ink text
 * All variants: 110px radius, 16px 28px padding, Inter 500.
 */
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'ghost';

const VARIANT_CLASS: Record<Variant, string> = {
  primary:   'bg-brand-500 text-white hover:bg-brand-600',
  secondary: 'bg-ink text-white hover:bg-ink/90',
  tertiary:  'bg-surface text-ink hover:bg-surface/70',
  ghost:     'bg-transparent text-ink hover:bg-surface',
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-pill px-7 py-4 text-sm font-medium font-sans transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60 disabled:cursor-not-allowed';

type CommonProps = {
  variant?: Variant;
  className?: string;
  children: ReactNode;
};

export function PillButton(
  props: CommonProps & ComponentProps<'button'>,
) {
  const { variant = 'primary', className = '', children, ...rest } = props;
  return (
    <button {...rest} className={`${BASE} ${VARIANT_CLASS[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function PillLink(
  props: CommonProps & ComponentProps<typeof Link>,
) {
  const { variant = 'primary', className = '', children, ...rest } = props;
  return (
    <Link {...rest} className={`${BASE} ${VARIANT_CLASS[variant]} ${className}`}>
      {children}
    </Link>
  );
}
