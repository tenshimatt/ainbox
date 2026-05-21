import type { Config } from 'tailwindcss';

/**
 * Task Response brand tokens — ported 1:1 from the Fundely Framer baseline
 * (https://grateful-types-938715.framer.app/). Tokens scraped from rendered
 * DOM 2026-05-20: brand orange #FF4F01, ink #060606, surface #F7F7F8.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#4169E1',
          50:  '#eef2fd',
          100: '#dbe3fb',
          200: '#b7c8f7',
          300: '#8ea7f1',
          400: '#6486ea',
          500: '#4169E1', // royal blue
          600: '#3354c4',
          700: '#2741a0',
          800: '#1c2f78',
          900: '#121e4d',
        },
        ink:     '#060606',
        surface: '#F7F7F8',
        muted:   '#3B404C',
      },
      fontFamily: {
        sans:    ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-inter-display)', 'var(--font-inter)', 'sans-serif'],
        serif:   ['var(--font-playfair)', 'Georgia', 'serif'],
      },
      fontSize: {
        // Fundely type scale (px in source → rem here, 16px base)
        'hero':    ['3.25rem', { lineHeight: '1',     letterSpacing: '-0.04em', fontWeight: '500' }], // 52px
        'display': ['2.375rem',{ lineHeight: '1.1',   letterSpacing: '-0.04em', fontWeight: '500' }], // 38px
        'title':   ['1.5rem',  { lineHeight: '1.2',   letterSpacing: '-0.02em', fontWeight: '500' }], // 24px
      },
      borderRadius: {
        pill: '110px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(6,6,6,0.04), 0 8px 24px rgba(6,6,6,0.06)',
      },
    },
  },
  plugins: [],
};
export default config;
