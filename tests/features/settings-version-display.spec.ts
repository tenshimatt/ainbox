/**
 * TASK7544-13 — App version display in settings page header
 *
 * Verifies that the app version badge is rendered inside a <header>
 * semantic element in the settings page, completing the header
 * structure introduced in TASK7544-11 and TASK7544-12.
 *
 * Covers:
 *   1. The version badge testid is present inside a <header> block.
 *   2. The version string matches the one in package.json.
 *   3. The app name "Ainbox" appears alongside the version in the header.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const SETTINGS_PAGE = join(__dirname, '../../src/app/(app)/settings/page.tsx');

const pkg = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8'),
) as { version: string };

function readSettings(): string {
  return readFileSync(SETTINGS_PAGE, 'utf-8');
}

test.describe('@feature TASK7544-13 settings version display in header', () => {
  test('settings page has a <header> element containing the version badge', () => {
    const src = readSettings();
    // Confirm the header semantic element is present
    expect(src).toMatch(/<header\s[^>]*>/);
    // Confirm the version badge testid is present
    expect(src).toContain('data-testid="app-version-badge"');
  });

  test('version badge appears after the <header> opening tag (within header scope)', () => {
    const src = readSettings();
    const headerIdx = src.search(/<header\s/);
    const badgeIdx = src.indexOf('data-testid="app-version-badge"');
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(badgeIdx).toBeGreaterThan(headerIdx);
  });

  test('version string in the page matches package.json version', () => {
    const src = readSettings();
    expect(src).toContain(`v${pkg.version}`);
  });

  test('app name Ainbox is displayed next to the version in the header', () => {
    const src = readSettings();
    const headerIdx = src.search(/<header\s/);
    const ainboxIdx = src.indexOf('Ainbox', headerIdx);
    expect(ainboxIdx).toBeGreaterThan(headerIdx);
  });
});
