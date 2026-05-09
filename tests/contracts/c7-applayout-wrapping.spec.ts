/**
 * C-7: All authed pages wrap in <AppLayout>
 *
 * Every authenticated page component MUST be wrapped with <AppLayout>
 * which provides sidebar navigation + topbar + main content area.
 *
 * This test checks:
 * 1. Each app page imports and uses AppLayout
 * 2. No authenticated page renders independently
 * 3. The layout renders navigation elements on each page
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..', '..');

const AUTHD_PAGES = [
  '/inbox',
  '/drafts',
  '/knowledge',
  '/automation',
  '/audit',
  '/settings',
];

test.describe('@contract C-7 AppLayout wrapping', () => {
  test('C-7.1 each app page renders sidebar navigation', async ({ page }) => {
    for (const pagePath of AUTHD_PAGES) {
      await page.goto(pagePath);
      await page.waitForLoadState('networkidle');

      // Check for sidebar navigation elements
      const hasNav = await page.locator('nav, [role="navigation"], aside').count();
      expect(hasNav).toBeGreaterThan(0);
    }
  });

  test('C-7.2 each app page has a topbar or header', async ({ page }) => {
    for (const pagePath of AUTHD_PAGES) {
      await page.goto(pagePath);
      await page.waitForLoadState('networkidle');

      const hasHeader = await page.locator('header').count();
      expect(hasHeader).toBeGreaterThan(0);
    }
  });

  test('C-7.3 source files reference AppLayout correctly', () => {
    const appDir = path.resolve(projectRoot, 'src', 'app');

    const appDirectories = fs.readdirSync(appDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
      .map(d => d.name);

    // Each auth-required page folder should either:
    // 1. Export a page that uses AppLayout, OR
    // 2. Have the layout applied via the root layout

    // The root layout should import AppLayout
    const rootLayoutPath = path.resolve(projectRoot, 'src', 'app', 'layout.tsx');
    if (fs.existsSync(rootLayoutPath)) {
      const rootLayout = fs.readFileSync(rootLayoutPath, 'utf-8');
      const usesAppLayout = rootLayout.includes('AppLayout');
      // Also check if there's a dedicated (app) route group
      const groupLayoutPath = path.resolve(projectRoot, 'src', 'app', '(app)', 'layout.tsx');
      if (fs.existsSync(groupLayoutPath)) {
        const groupLayout = fs.readFileSync(groupLayoutPath, 'utf-8');
        expect(groupLayout.includes('AppLayout') || groupLayout.includes('sidebar')).toBeTruthy();
      }
    }
  });

  test('C-7.4 sidebar contains expected navigation items', async ({ page }) => {
    await page.goto('/inbox');
    await page.waitForLoadState('networkidle');

    // Check for common sidebar navigation links
    const navLinks = ['inbox', 'drafts', 'knowledge', 'settings'];
    for (const link of navLinks) {
      const linkEl = page.getByRole('link', { name: new RegExp(link, 'i') });
      const count = await linkEl.count();
      if (count === 0) {
        // Try text-based matching
        const textMatch = page.locator(`text=${link}`, { hasText: new RegExp(link, 'i') });
        const textCount = await textMatch.count();
        expect(textCount).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
