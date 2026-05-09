/**
 * C-6: Mobile-first: 375px viewport renders without overflow
 *
 * Every authenticated dashboard page MUST render without horizontal
 * overflow at 375px viewport width. Enforced by Playwright smoke.
 *
 * This test checks every app page at 375px viewport.
 */

import { test, expect } from '@playwright/test';

const APP_PAGES = [
  '/inbox',
  '/drafts',
  '/knowledge',
  '/automation',
  '/audit',
  '/settings',
];

const PUBLIC_PAGES = [
  '/',
  '/pricing',
  '/security',
  '/connect',
];

test.describe('@contract C-6 mobile 375px no overflow', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone 12/13 dimensions

  for (const pagePath of APP_PAGES) {
    test(`C-6.1 ${pagePath} no horizontal overflow`, async ({ page }) => {
      const resp = await page.goto(pagePath);
      expect(resp?.status()).toBeLessThan(500);

      await page.waitForLoadState('networkidle');

      // Check for horizontal overflow
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      if (hasOverflow) {
        // If overflow exists, find the offending element
        const overflowInfo = await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll('*'));
          for (const el of all) {
            const rect = el.getBoundingClientRect();
            if (rect.right > document.documentElement.clientWidth + 1) {
              return {
                tag: el.tagName,
                id: el.id,
                class: el.className,
                right: rect.right,
                viewport: document.documentElement.clientWidth,
                width: rect.width,
              };
            }
          }
          return null;
        });
        console.log(`Overflow on ${pagePath}:`, JSON.stringify(overflowInfo));
      }

      expect(hasOverflow).toBeFalsy();
    });
  }

  for (const pagePath of PUBLIC_PAGES) {
    test(`C-6.2 ${pagePath} no horizontal overflow`, async ({ page }) => {
      const resp = await page.goto(pagePath);
      expect(resp?.status()).toBeLessThan(500);

      await page.waitForLoadState('networkidle');

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      expect(hasOverflow).toBeFalsy();
    });
  }
});
