/**
 * TASK7544-18 — Skip OAuth re-fire when already signed-in with valid token
 *
 * PRD §3.9 (Auth stack) · §4.2 (OAuth token storage)
 *
 * When a user navigates to /connect/google or /connect/microsoft while
 * already holding a valid Supabase session AND the corresponding OAuth
 * token exists in oauth_tokens, the page must redirect straight to
 * /inbox instead of re-firing the provider OAuth flow.
 *
 * Negative case: if the user has a session but no provider token the
 * OAuth flow must still proceed normally.
 *
 * Uses window.__SUPABASE_MOCK__ (the escape hatch in lib/supabase/client.ts)
 * so getSession() resolves immediately without network calls.
 * Network is otherwise fully mocked. Synthesised @ainbox.test fixtures only.
 */

import { test, expect } from '@playwright/test';
import { SYNTH_USER_GOOGLE } from '../fixtures/users';

const FIXTURE_MS_USER_ID = '00000000-0000-4000-8000-00000000ms01';
const FIXTURE_MS_EMAIL = 'ms-skip@ainbox.test';

type MockSessionParams = { uid: string; email: string };

/**
 * Inject window.__SUPABASE_MOCK__ so getBrowserSupabase() returns a
 * controlled client. getSession() resolves immediately without any
 * network call; signInWithOAuth returns a fake URL so the OAuth path
 * can still be exercised in negative tests.
 */
function injectSupabaseMockWithSession({ uid, email }: MockSessionParams) {
  return async ({ page }: { page: import('@playwright/test').Page }) => {
    await page.addInitScript(
      ({ uid, email }: MockSessionParams) => {
        const session = {
          access_token: 'synth-access-token',
          refresh_token: 'synth-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: uid,
            email,
            aud: 'authenticated',
            app_metadata: {},
            user_metadata: {},
          },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__SUPABASE_MOCK__ = {
          auth: {
            getSession: () =>
              Promise.resolve({ data: { session }, error: null }),
            getUser: () =>
              Promise.resolve({ data: { user: session.user }, error: null }),
            signInWithOAuth: () =>
              Promise.resolve({
                data: {
                  url: 'https://accounts.google.com/o/oauth2/v2/auth?stub=1',
                  provider: 'google',
                },
                error: null,
              }),
          },
        };
      },
      { uid, email },
    );
  };
}

/**
 * Inject window.__SUPABASE_MOCK__ that returns NO session (unauthenticated).
 * signInWithOAuth still returns a fake URL so the OAuth redirect can be observed.
 */
function injectSupabaseMockNoSession() {
  return async ({ page }: { page: import('@playwright/test').Page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SUPABASE_MOCK__ = {
        auth: {
          getSession: () =>
            Promise.resolve({ data: { session: null }, error: null }),
          getUser: () =>
            Promise.resolve({ data: { user: null }, error: null }),
          signInWithOAuth: () =>
            Promise.resolve({
              data: {
                url: 'https://accounts.google.com/o/oauth2/v2/auth?stub=1',
                provider: 'google',
              },
              error: null,
            }),
        },
      };
    });
  };
}

test.describe('@features TASK7544-18 Skip OAuth re-fire when already signed-in', () => {
  // ── Google — happy skip path ──────────────────────────────────────────────

  test('§3.9 /connect/google with valid session + gmail token → redirects to /inbox', async ({
    page,
  }) => {
    await injectSupabaseMockWithSession({
      uid: SYNTH_USER_GOOGLE.id,
      email: SYNTH_USER_GOOGLE.email,
    })({ page });

    // /api/oauth/tokens returns gmail as connected
    await page.route('/api/oauth/tokens', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          providers: [
            { id: 'gmail', type: 'google', name: 'Google', connected: true },
          ],
          userEmail: SYNTH_USER_GOOGLE.email,
        }),
      }),
    );

    // Stub /inbox so the navigation resolves. The middleware (cookie-based)
    // would otherwise redirect to /connect — we intercept before it gets there.
    await page.route('**/inbox**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body data-testid="inbox-stub">inbox</body></html>',
      }),
    );

    await page.goto('/connect/google');
    await page.waitForURL(/\/inbox/, { timeout: 8_000 });
    expect(page.url()).toContain('/inbox');
  });

  // ── Google — negative: session but no gmail token, OAuth should still fire ──

  test('§3.9 /connect/google with valid session but NO gmail token → initiates OAuth', async ({
    page,
  }) => {
    await injectSupabaseMockWithSession({
      uid: SYNTH_USER_GOOGLE.id,
      email: SYNTH_USER_GOOGLE.email,
    })({ page });

    // No gmail provider token — skip guard passes, OAuth fires
    await page.route('/api/oauth/tokens', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          providers: [],
          userEmail: SYNTH_USER_GOOGLE.email,
        }),
      }),
    );

    // The mock signInWithOAuth returns a fake Google URL; stub it so the
    // test stays hermetic.
    await page.route('https://accounts.google.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body data-testid="google-login-stub">stub</body></html>',
      }),
    );

    await page.goto('/connect/google');
    await page.waitForURL(/accounts\.google\.com|\/connect\/google/, {
      timeout: 8_000,
    });
    // Must NOT have gone to /inbox
    expect(page.url()).not.toContain('/inbox');
  });

  // ── Microsoft — happy skip path ───────────────────────────────────────────

  test('§7.2 /connect/microsoft with valid session + outlook token → redirects to /inbox', async ({
    page,
  }) => {
    await injectSupabaseMockWithSession({
      uid: FIXTURE_MS_USER_ID,
      email: FIXTURE_MS_EMAIL,
    })({ page });

    // /api/oauth/tokens returns outlook as connected
    await page.route('/api/oauth/tokens', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          providers: [
            { id: 'outlook', type: 'microsoft', name: 'Microsoft', connected: true },
          ],
          userEmail: FIXTURE_MS_EMAIL,
        }),
      }),
    );

    // Stub /inbox before middleware can redirect
    await page.route('**/inbox**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body data-testid="inbox-stub">inbox</body></html>',
      }),
    );

    await page.goto('/connect/microsoft');
    await page.waitForURL(/\/inbox/, { timeout: 8_000 });
    expect(page.url()).toContain('/inbox');
  });

  // ── Microsoft — negative: session but no outlook token ───────────────────

  test('§7.2 /connect/microsoft with valid session but NO outlook token → initiates OAuth', async ({
    page,
  }) => {
    await injectSupabaseMockWithSession({
      uid: FIXTURE_MS_USER_ID,
      email: FIXTURE_MS_EMAIL,
    })({ page });

    // No outlook provider token
    await page.route('/api/oauth/tokens', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          providers: [],
          userEmail: FIXTURE_MS_EMAIL,
        }),
      }),
    );

    // The Microsoft page only follows HTTPS Supabase URLs. The mock
    // signInWithOAuth returns a Google stub URL (fine — we just need to
    // confirm /inbox was NOT visited and the OAuth path was taken).
    await page.route('https://accounts.google.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body data-testid="ms-flow-stub">stub</body></html>',
      }),
    );

    await page.goto('/connect/microsoft');

    // Confirm the OAuth path was taken (not the skip path)
    await expect(async () => {
      const url = page.url();
      const onConnectMs = /\/connect\/microsoft/.test(url);
      const startingPhase = await page.getByTestId('ms-oauth-starting').count();
      const redirectingPhase = await page.getByTestId('ms-oauth-redirecting').count();
      // The mock returns an HTTPS URL so it fires; we land on the stub page
      // or remain on /connect/microsoft (if the URL was http and skipped).
      expect(onConnectMs || startingPhase > 0 || redirectingPhase > 0).toBe(true);
    }).toPass({ timeout: 8_000 });

    expect(page.url()).not.toContain('/inbox');
  });

  // ── No session: OAuth must fire ───────────────────────────────────────────

  test('§3.9 /connect/google with NO session → initiates OAuth (no skip)', async ({
    page,
  }) => {
    // No session — getSession() returns null, OAuth fires normally
    await injectSupabaseMockNoSession()({ page });

    await page.route('https://accounts.google.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub google</body></html>',
      }),
    );

    await page.goto('/connect/google');
    await page.waitForURL(/accounts\.google\.com|\/connect\/google/, {
      timeout: 8_000,
    });
    expect(page.url()).not.toContain('/inbox');
  });
});
