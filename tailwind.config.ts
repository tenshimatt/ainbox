import type { Config } from 'tailwindcss';

/**
 * Task Response brand tokens.
 * `brand` maps to a vivid orange (Tailwind's `orange` scale) chosen during the
 * 2026-05-13 styling call ("bright, fun deli, Framer-style"). To swap palettes
 * later, just change these RHS values — every CTA / focus ring / brand
 * accent across the app reads through `brand-*`.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
      },
    },
  },
  plugins: [],
};
export default config;
