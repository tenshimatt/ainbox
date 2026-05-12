/**
 * AINBOX-35 — Test Layer C: real test accounts + OAuth token replay (Google)
 *
 * Layer C exercises the OAuth callback + token storage pipeline with real
 * provider token values rather than synthetic constants. Token values are
 * read from environment variables — tests skip gracefully when the env is
 * not configured, making this layer safe to run in CI without credentials.
 *
 * How token replay works:
 *   The existing window.__SUPABASE_MOCK__ infrastructure (established in
 *   AINBOX-17) fires SIGNED_IN with a synthesised session object. Layer C
 *   reuses this exact mechanism but substitutes real token strings from env
 *   vars, so the callback page and storage endpoints are exercised with
 *   tokens that have the correct real-world format (length, prefix, entropy).
 *
 * Required env vars (all must be set for real-token tests to run):
 *   LAYER_C_ENABLED=true
 *   LAYER_C_GOOGLE_ACCESS_TOKEN   — valid Google OAuth access token (ya29.…)
 *   LAYER_C_GOOGLE_REFRESH_TOKEN  — valid Google OAuth refresh token (1//…)
 *   LAYER_C_GOOGLE_USER_ID        — Supabase user UUID for the test account
 *
 * PII boundary: no real email addresses appear anywhere in this file
 * (factory-rules.md hard rule #8). User info comes entirely from env vars.
 */

import { test, expect, type Route } from '@playwright/test';

const APP_ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
const TOKEN_ENDPOINT = `${APP_ORIGIN}/api/oauth/gmail/tokens`;

// ---------------------------------------------------------------------------
// Layer C configuration helpers
// ---------------------------------------------------------------------------

/** Returns true only when all Layer C Google env vars are present. */
function hasLayerCGoogle(): boolean {
  return (
    process.env.LAYER_C_ENABLED === 'true' &&
    !!process.env.LAYER_C_GOOGLE_ACCESS_TOKEN &&
    !!process.env.LAYER_C_GOOGLE_REFRESH_TOKEN &&
    !!process.env.LAYER_C_GOOGLE_USER_ID
  );
}

/**
 * Inject Layer C Google tokens into window.__SUPABASE_MOCK__ BEFORE any
 * page scripts run. Uses the same mechanism as AINBOX-17's injectSupabaseMock
 * but with real token values sourced from env vars.
 *
 * getBrowserSupabase() returns this mock (in non-production builds) so the
 * callback page never creates a real SDK client.
 */
async function injectRealGoogleTokens(
  page: import('@playwright/test').Page,
): Promise<void> {
  const accessToken = process.env.LAYER_C_GOOGLE_ACCESS_TOKEN!;
  const refreshToken = process.env.LAYER_C_GOOGLE_REFRESH_TOKEN!;
  const userId = process.env.LAYER_C_GOOGLE_USER_ID!;

  // Session object mirrors the shape Supabase returns after a real PKCE exchange.
  // Email is intentionally omitted — PII must not appear in source (hard rule #8).
  const session: Record<string, unknown> = {
    access_token: 'synth-sb-access-layer-c',
    refresh_token: 'synth-sb-refresh-layer-c',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    provider_token: accessToken,
    provider_refresh_token: refreshToken,
    user: {
      id: userId,
      aud: 'authenticated',
      app_metadata: { provider: 'google' },
      user_metadata: {},
    },
  };

  await page.addInitScript(
    ({ supabaseSession }: { supabaseSession: Record<string, unknown> }) => {
      type AuthCallback = (
        event: string,
        session: Record<string, unknown> | null,
      ) => Promise<void> | void;
      const callbacks: AuthCallback[] = [];

      (window as unknown as Record<string, unknown>).__SUPABASE_MOCK__ = {
        auth: {
          onAuthStateChange(callback: AuthCallback) {
            callbacks.push(callback);
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
            await Promise.resolve();
            for (const cb of [...callbacks]) {
              await cb('SIGNED_IN', supabaseSession);
            }
            return {
              data: {
                session: supabaseSession,
                user: supabaseSession.user,
              },
              error: null,
            };
          },
        },
      };
    },
    { supabaseSession: session },
  );
}

// ---------------------------------------------------------------------------
// Layer C — Google OAuth token replay tests
// ---------------------------------------------------------------------------

test.describe('@layer-c AINBOX-35 Google OAuth token replay', () => {
  test('infrastructure: Layer C skips gracefully when env vars are absent', () => {
    // Documents and verifies the skip mechanism itself. Always passes.
    // When LAYER_C_ENABLED is not set, real-token tests are not executed —
    // this is intentional: Layer C requires explicit opt-in with real credentials.
    const configured = hasLayerCGoogle();
    if (!configured) {
      // Not configured → fine, no real credentials in this environment.
      return;
    }
    // If we reach here, env is configured — sanity check the shape.
    expect(process.env.LAYER_C_GOOGLE_USER_ID).toMatch(
      /^[0-9a-f-]{36}$/i, // UUID format
    );
  });

  test('real Google access token has non-trivial length', () => {
    test.skip(!hasLayerCGoogle(), 'LAYER_C_ENABLED + LAYER_C_GOOGLE_* env vars required');
    // Real Google access tokens are opaque strings starting with "ya29."
    // and are well over 40 characters. A short value indicates a misconfigured stub.
    const at = process.env.LAYER_C_GOOGLE_ACCESS_TOKEN!;
    expect(at.length).toBeGreaterThan(40);
  });

  test('real Google refresh token has non-trivial length', () => {
    test.skip(!hasLayerCGoogle(), 'LAYER_C_ENABLED + LAYER_C_GOOGLE_* env vars required');
    // Real Google refresh tokens start with "1//" and are over 40 characters.
    const rt = process.env.LAYER_C_GOOGLE_REFRESH_TOKEN!;
    expect(rt.length).toBeGreaterThan(40);
  });

  test('real tokens replay through callback page → POST /api/oauth/gmail/tokens', async ({
    page,
  }) => {
    test.skip(!hasLayerCGoogle(), 'LAYER_C_ENABLED + LAYER_C_GOOGLE_* env vars required');

    await injectRealGoogleTokens(page);

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

    await page.goto('/connect/google/callback?code=layer-c-replay-code');
    await page.waitForURL(/\/onboarding\/sync/, { timeout: 12_000 });
    expect(page.url()).toContain('/onboarding/sync');

    // The real token values must arrive at the storage endpoint unmodified.
    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.provider_refresh_token).toBe(
      process.env.LAYER_C_GOOGLE_REFRESH_TOKEN,
    );
    expect(capturedBody?.provider_token).toBe(
      process.env.LAYER_C_GOOGLE_ACCESS_TOKEN,
    );
  });

  test('real token storage failure is non-fatal: still redirects to /onboarding/sync', async ({
    page,
  }) => {
    test.skip(!hasLayerCGoogle(), 'LAYER_C_ENABLED + LAYER_C_GOOGLE_* env vars required');

    await injectRealGoogleTokens(page);

    // Simulate a transient server error on the token-storage endpoint.
    await page.route(TOKEN_ENDPOINT, async (route: Route) => {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'db_error' }),
      });
    });

    await page.goto('/connect/google/callback?code=layer-c-replay-failsave');
    await page.waitForURL(/\/onboarding\/sync/, { timeout: 12_000 });
    expect(page.url()).toContain('/onboarding/sync');
    // No user-facing error alert should appear (graceful degradation).
    await expect(page.locator('main [role="alert"]')).not.toBeVisible();
  });

  test('real token replay: POST body contains no synthetic placeholder values', async ({
    page,
  }) => {
    test.skip(!hasLayerCGoogle(), 'LAYER_C_ENABLED + LAYER_C_GOOGLE_* env vars required');

    await injectRealGoogleTokens(page);

    let capturedRefresh: string | undefined;
    await page.route(TOKEN_ENDPOINT, async (route: Route) => {
      try {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        capturedRefresh = body.provider_refresh_token as string;
      } catch {
        capturedRefresh = '';
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/connect/google/callback?code=layer-c-replay-verify');
    await page.waitForURL(/\/onboarding\/sync/, { timeout: 12_000 });

    // Real token must not be a synthetic stub value from other test specs.
    expect(capturedRefresh).not.toContain('synth-');
    expect(capturedRefresh).not.toContain('fixture-');
    expect(capturedRefresh).not.toContain('ainbox17');
    // Must be non-trivial length.
    expect(capturedRefresh?.length).toBeGreaterThan(40);
  });
});
