/**
 * TASKRESPONSE-17 — Gmail API OAuth: real token exchange + refresh.
 *
 * PRD: §4.2 (OAuth token storage) · §7.1 (Provider OAuth — Google)
 *
 * Feature implementation coverage:
 *   1. POST /api/oauth/gmail/tokens endpoint is auth-protected (§4.1).
 *   2. Callback page saves provider tokens when present in the SIGNED_IN session (§4.2).
 *   3. Token save failure is non-fatal — redirect still occurs (§5.2).
 *   4. When no provider_refresh_token, token save endpoint is not called (§4.2).
 *
 * Testing approach:
 *   The Supabase SDK bundles its own fetch reference at webpack compile time,
 *   making window.fetch patching ineffective at test time. Instead, we inject
 *   window.__SUPABASE_MOCK__ via addInitScript. getBrowserSupabase() returns this
 *   mock (in non-production builds) so the callback page never creates a real SDK
 *   client. The mock fires SIGNED_IN with a synthetic session when
 *   exchangeCodeForSession() is called.
 *
 *   page.route() intercepts the /api/oauth/gmail/tokens Next.js route call.
 *
 * Fixtures: @taskresponse.test domain (factory-rules.md hard rule #8).
 */

import { test, expect, type Route } from '@playwright/test';
import { SYNTH_USER_GOOGLE } from '../fixtures/users';

// Full URL so Playwright intercepts same-origin fetch from the callback page.
const APP_ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
const TOKEN_ENDPOINT = `${APP_ORIGIN}/api/oauth/gmail/tokens`;

const SYNTH_GMAIL_REFRESH = 'synth-gmail-refresh-taskresponse17';
const SYNTH_GMAIL_ACCESS = 'synth-gmail-access-taskresponse17';

/**
 * Inject a Supabase mock into the browser via window.__SUPABASE_MOCK__ BEFORE any
 * page scripts run. getBrowserSupabase() checks for this mock in non-production
 * builds, so the callback page uses it instead of creating a real SDK client.
 *
 * The mock fires SIGNED_IN (with or without provider tokens) when
 * exchangeCodeForSession() is called, mirroring the real PKCE exchange behaviour.
 *
 * The /api/oauth/gmail/tokens Next.js route is intercepted separately via page.route().
 */
async function injectSupabaseMock(
  page: import('@playwright/test').Page,
  opts: { includeProviderTokens: boolean },
) {
  const session: Record<string, unknown> = {
    access_token: 'synth-sb-access',
    refresh_token: 'synth-sb-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: SYNTH_USER_GOOGLE.id,
      email: SYNTH_USER_GOOGLE.email,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
    },
  };
  if (opts.includeProviderTokens) {
    session.provider_token = SYNTH_GMAIL_ACCESS;
    session.provider_refresh_token = SYNTH_GMAIL_REFRESH;
  }

  await page.addInitScript(
    ({ supabaseSession }: { supabaseSession: Record<string, unknown> }) => {
      // Build a minimal Supabase-shaped mock. getBrowserSupabase() returns this
      // instead of creating a real SDK client when window.__SUPABASE_MOCK__ is set
      // (only checked in non-production builds).
      type AuthCallback = (event: string, session: Record<string, unknown> | null) => Promise<void> | void;
      const callbacks: AuthCallback[] = [];

      (window as unknown as Record<string, unknown>).__SUPABASE_MOCK__ = {
        auth: {
          onAuthStateChange(callback: AuthCallback) {
            callbacks.push(callback);
            // Mirrors real SDK: fire INITIAL_SESSION asynchronously on subscribe.
            Promise.resolve().then(() => callback('INITIAL_SESSION', null));
            return {
              data: {
                subscription: {
                  unsubscribe() {
                    const i = callbacks.indexOf(callback);
                    if (i !== -1) callbacks.splice(i, 1);
                  },
                },
              },
            };
          },
          async exchangeCodeForSession(_code: string) {
            // Fire SIGNED_IN with the synthetic session after yielding.
            // This mirrors the real SDK's async behaviour.
            await Promise.resolve();
            for (const cb of [...callbacks]) {
              await cb('SIGNED_IN', supabaseSession);
            }
            return {
              data: { session: supabaseSession, user: supabaseSession.user },
              error: null,
            };
          },
        },
      };
    },
    { supabaseSession: session },
  );
}

test.describe('@features TASKRESPONSE-17 Gmail OAuth token exchange + refresh', () => {
  test('§4.1 /api/oauth/gmail/tokens endpoint requires authentication', async ({ page }) => {
    // Direct unauthenticated request must be rejected (§4.1 tenant isolation).
    const resp = await page.request.post(`${APP_ORIGIN}/api/oauth/gmail/tokens`, {
      data: { provider_refresh_token: 'any-token' },
    });
    // 401 when Supabase is reachable and auth fails. Accept 400 for missing body too.
    expect([401, 400]).toContain(resp.status());
  });

  test('§4.2 saves Gmail provider tokens to /api/oauth/gmail/tokens after SIGNED_IN', async ({
    page,
  }) => {
    await injectSupabaseMock(page, { includeProviderTokens: true });

    let capturedBody: Record<string, unknown> | null = null;
    await page.route(TOKEN_ENDPOINT, async (route: Route) => {
      try {
        capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        capturedBody = {};
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    // ?code= triggers the PKCE exchange; our patched fetch returns a session with tokens.
    await page.goto('/connect/google/callback?code=synth-code-taskresponse17');
    await page.waitForURL(/\/onboarding\/sync/, { timeout: 12_000 });
    expect(page.url()).toContain('/onboarding/sync');

    // Provider tokens from the exchange response must be POSTed to the save endpoint.
    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.provider_refresh_token).toBe(SYNTH_GMAIL_REFRESH);
    expect(capturedBody?.provider_token).toBe(SYNTH_GMAIL_ACCESS);
  });

  test('§4.2 token save failure is non-fatal: still redirects to /onboarding/sync', async ({
    page,
  }) => {
    await injectSupabaseMock(page, { includeProviderTokens: true });

    // 500 from the token-save route must not block the user.
    await page.route(TOKEN_ENDPOINT, async (route: Route) => {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'db error' }),
      });
    });

    await page.goto('/connect/google/callback?code=synth-code-failure');
    await page.waitForURL(/\/onboarding\/sync/, { timeout: 12_000 });
    expect(page.url()).toContain('/onboarding/sync');
    // No user-facing error alert (excludes the Next.js route announcer).
    await expect(page.locator('main [role="alert"]')).not.toBeVisible();
  });

  test('§4.2 no provider_refresh_token in session: token save endpoint not called', async ({
    page,
  }) => {
    // Supabase returns a session WITHOUT provider tokens (scope not granted).
    await injectSupabaseMock(page, { includeProviderTokens: false });

    let tokenSaveCalled = false;
    await page.route(TOKEN_ENDPOINT, async (route: Route) => {
      tokenSaveCalled = true;
      return route.fulfill({ status: 200, body: '{"ok":true}' });
    });

    await page.goto('/connect/google/callback?code=synth-code-no-tokens');
    await page.waitForURL(/\/onboarding\/sync/, { timeout: 12_000 });
    expect(page.url()).toContain('/onboarding/sync');
    // Token save must NOT be called when provider_refresh_token is absent.
    expect(tokenSaveCalled).toBe(false);
  });
});
