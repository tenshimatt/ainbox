/**
 * TASK7544-12 — Settings page header alignment on mobile (375px)
 *
 * The settings page h1 was using a fixed `text-2xl` class, causing
 * over-large text with alignment issues at 375px. Fixed to use the
 * mobile-first pattern `text-xl sm:text-2xl` used by all other app pages.
 *
 * Acceptance criteria:
 * - Settings h1 uses responsive sizing: text-xl on mobile, sm:text-2xl on larger screens
 * - Header is wrapped in a <header> semantic element
 * - Page root is a <main> element (matches all other app pages)
 * - Tab nav uses sm:gap-6 so spacing is smaller on mobile (gap-4)
 * - "Add Provider" buttons use flex-wrap so they don't overflow on narrow screens
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SETTINGS_PAGE = path.join(
  __dirname,
  '../../src/app/(app)/settings/page.tsx',
);

function readSettings(): string {
  return fs.readFileSync(SETTINGS_PAGE, 'utf-8');
}

test.describe('@feature TASK7544-12 settings header mobile alignment', () => {
  test('h1 uses mobile-first responsive text size (text-xl sm:text-2xl)', () => {
    const src = readSettings();
    // Must use text-xl as base (mobile) with sm:text-2xl breakpoint
    expect(src).toContain('text-xl font-bold text-slate-900 sm:text-2xl');
    // Must NOT use a bare standalone text-2xl without a responsive prefix on the h1
    expect(src).not.toMatch(/<h1[^>]*className="text-2xl /);
  });

  test('heading is wrapped in a <header> semantic element', () => {
    const src = readSettings();
    expect(src).toMatch(/<header\s[^>]*>/);
  });

  test('page root container is a <main> element (matches other app pages)', () => {
    const src = readSettings();
    expect(src).toMatch(/<main\s[^>]*>/);
  });

  test('tab nav uses gap-4 on mobile and sm:gap-6 on larger screens', () => {
    const src = readSettings();
    expect(src).toContain('gap-4 sm:gap-6');
  });

  test('Add Provider buttons use flex-wrap to prevent overflow on narrow screens', () => {
    const src = readSettings();
    expect(src).toContain('flex flex-wrap gap-3');
  });
});
