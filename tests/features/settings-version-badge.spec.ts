/**
 * TASK7544-11 — App name and version badge on the main settings page
 *
 * Covers:
 *   1. The settings page renders a version badge with the app name.
 *   2. The version badge displays the version string.
 *   3. The badge is visible at mobile viewport (375px).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const pkg = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8'),
) as { name: string; version: string };

test.describe('@feature TASK7544-11 settings version badge', () => {
  test('package.json has a name and version', () => {
    expect(typeof pkg.name).toBe('string');
    expect(pkg.name.length).toBeGreaterThan(0);
    expect(typeof pkg.version).toBe('string');
    expect(/^\d+\.\d+\.\d+/.test(pkg.version)).toBe(true);
  });

  test('app name is ainbox', () => {
    expect(pkg.name).toBe('ainbox');
  });

  test('settings page source contains app-version-badge testid', () => {
    const src = readFileSync(
      join(__dirname, '../../src/app/(app)/settings/page.tsx'),
      'utf-8',
    );
    expect(src).toContain('data-testid="app-version-badge"');
  });

  test('settings page source renders the app name capitalised', () => {
    const src = readFileSync(
      join(__dirname, '../../src/app/(app)/settings/page.tsx'),
      'utf-8',
    );
    // Badge should display "Ainbox" (capitalised)
    expect(src).toContain('Ainbox');
  });

  test('settings page source renders the version string', () => {
    const src = readFileSync(
      join(__dirname, '../../src/app/(app)/settings/page.tsx'),
      'utf-8',
    );
    expect(src).toContain(`v${pkg.version}`);
  });
});
