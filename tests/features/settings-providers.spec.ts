/**
 * TASK7544-21 — /settings/providers as re-link / add-mailbox surface
 *
 * The /settings/providers page is the canonical surface for:
 *   - Viewing connected mailboxes (with Disconnect button)
 *   - Re-linking disconnected mailboxes (amber Re-link → /connect/{provider})
 *   - Adding new mailboxes (Connect Google / Connect Microsoft links)
 *
 * Browser navigation to /settings/providers redirects to /connect when
 * unauthenticated (tested in auth-google.spec.ts). We verify the page
 * structure via source-file inspection, matching the established pattern
 * used by settings-header-mobile.spec.ts and settings-version-badge.spec.ts.
 *
 * Covers:
 *   1. Source contains re-link button (data-testid="relink-button").
 *   2. Source contains "Add mailbox" heading text.
 *   3. Re-link routes google providers to /connect/google.
 *   4. Re-link routes microsoft providers to /connect/microsoft.
 *   5. Add mailbox section has testids add-google and add-microsoft.
 *   6. Empty-state message testid is present.
 *   7. Page uses mobile-first responsive h1 (text-xl sm:text-2xl).
 *   8. Add mailbox buttons use flex-wrap to prevent overflow on 375px.
 *   9. Page heading is wrapped in <header> element.
 *  10. relinkUrl helper maps google→/connect/google, microsoft→/connect/microsoft.
 *  11. Disconnected provider renders amber "Disconnected" indicator (amber classes).
 *  12. Connected provider renders green "Connected" indicator (green classes).
 *  13. Page root is a <main> element (matches other app pages).
 *  14. Disconnect confirmation dialog uses correct aria-label.
 *  15. Disconnect dialog has Cancel + Disconnect buttons.
 *  16. Provider icon distinguishes Google (G) and Microsoft (M).
 *  17. Middleware: /settings/providers redirects unauthenticated users to /connect.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PROVIDERS_PAGE = path.join(
  __dirname,
  '../../src/app/(app)/settings/providers/page.tsx',
);

function readSrc(): string {
  return fs.readFileSync(PROVIDERS_PAGE, 'utf-8');
}

// ---- static source-file tests -----------------------------------------------

test.describe('@feature TASK7544-21 settings/providers source', () => {
  test('page source contains relink-button testid', () => {
    expect(readSrc()).toContain('data-testid="relink-button"');
  });

  test('page source contains "Add mailbox" section heading', () => {
    expect(readSrc()).toContain('Add mailbox');
  });

  test('page source routes google re-link to /connect/google', () => {
    expect(readSrc()).toContain('/connect/google');
  });

  test('page source routes microsoft re-link to /connect/microsoft', () => {
    expect(readSrc()).toContain('/connect/microsoft');
  });

  test('page source contains add-google and add-microsoft testids', () => {
    expect(readSrc()).toContain('data-testid="add-google"');
    expect(readSrc()).toContain('data-testid="add-microsoft"');
  });

  test('page source contains no-providers-message testid for empty state', () => {
    expect(readSrc()).toContain('data-testid="no-providers-message"');
  });

  test('page source uses mobile-first responsive h1 (text-xl sm:text-2xl)', () => {
    expect(readSrc()).toContain('text-xl font-bold text-slate-900 sm:text-2xl');
  });

  test('page source uses flex-wrap on add mailbox buttons to prevent overflow', () => {
    expect(readSrc()).toContain('flex flex-wrap gap-3');
  });

  test('page source wraps heading in <header> element', () => {
    expect(readSrc()).toMatch(/<header>/);
  });

  test('relinkUrl helper maps google type to /connect/google', () => {
    expect(readSrc()).toContain("return provider.type === 'google' ? '/connect/google' : '/connect/microsoft'");
  });

  test('disconnected provider shows amber indicator classes', () => {
    // amber-600 text for disconnected status
    expect(readSrc()).toContain('text-amber-600');
    expect(readSrc()).toContain('bg-amber-400');
  });

  test('connected provider shows green indicator classes', () => {
    expect(readSrc()).toContain('text-green-600');
    expect(readSrc()).toContain('bg-green-500');
  });

  test('page root is a <main> element', () => {
    expect(readSrc()).toMatch(/<main\s/);
  });

  test('disconnect dialog has aria-label="confirm disconnect"', () => {
    expect(readSrc()).toContain('aria-label="confirm disconnect"');
  });

  test('disconnect dialog has Cancel and Disconnect buttons', () => {
    expect(readSrc()).toContain('Cancel');
    // The dialog has a button with "Disconnect" text (multiline JSX)
    expect(readSrc()).toContain('Disconnect provider?');
    expect(readSrc()).toContain('handleDisconnect(disconnectConfirm)');
  });

  test('provider icon distinguishes Google (G) and Microsoft (M)', () => {
    expect(readSrc()).toContain("provider.type === 'google' ? 'G' : 'M'");
  });
});

// ---- browser: middleware redirects unauthenticated access -------------------

test.describe('@feature TASK7544-21 settings/providers browser auth guard', () => {
  test('unauthenticated /settings/providers redirects to /connect', async ({ page }) => {
    const resp = await page.goto('/settings/providers');
    // The middleware redirects to /connect, which returns a 200 page
    expect(resp?.status()).toBeLessThan(500);
    expect(page.url()).toMatch(/\/connect/);
  });
});
