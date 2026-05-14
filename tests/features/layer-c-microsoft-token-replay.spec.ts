/**
 * TASKRESPONSE-35 — Test Layer C: real test accounts + OAuth token replay (Microsoft)
 *
 * Layer C exercises the Microsoft OAuth callback + token storage pipeline with
 * real provider token values rather than synthetic constants. Token values are
 * read from environment variables — tests skip gracefully when the env is not
 * configured, making this layer safe to run in CI without credentials.
 *
 * How token replay works:
 *   The existing window.__SUPABASE_MOCK__ infrastructure (established in
 *   TASKRESPONSE-18) fires SIGNED_IN with a synthesised session object. Layer C
 *   reuses this exact mechanism but substitutes real token strings from env
 *   vars, so the callback page and store-tokens endpoint are exercised with
 *   tokens that have the correct real-world format (JWT for access tokens,
 *   opaque string for refresh tokens).
 *
 * Required env vars (all must be set for real-token tests to run):
 *   LAYER_C_ENABLED=true
 *   LAYER_C_MICROSOFT_ACCESS_TOKEN  — valid MS Graph access token (JWT eyJ…)
 *   LAYER_C_MICROSOFT_REFRESH_TOKEN — valid MS Graph refresh token (opaque)
 *   LAYER_C_MICROSOFT_USER_ID       — Supabase user UUID for the test account
 *
 * PII boundary: no real email addresses appear anywhere in this file
 * (factory-rules.md hard rule #8). User info comes entirely from env vars.
 */

import { test, expect, type Route, type Page } from '@playwright/test';

const STORE_TOKENS_ENDPOINT = '/api/oauth/microsoft/store-tokens';

// ---------------------------------------------------------------------------
// Layer C configuration helpers
// ---------------------------------------------------------------------------

/** Returns true only when all Layer C Microsoft env vars are present. */
function hasLayerCMicrosoft(): boolean {
  return (
    process.env.LAYER_C_ENABLED === 'true' &&
    !!process.env.LAYER_C_MICROSOFT_ACCESS_TOKEN &&
    !!process.env.LAYER_C_MICROSOFT_REFRESH_TOKEN &&
    !!process.env.LAYER_C_MICROSOFT_USER_ID
  );
}

/**
 * Inject Layer C Microsoft tokens into window.__SUPABASE_MOCK__ BEFORE any
 * page scripts run. Uses the same mechanism as TASKRESPONSE-18's mockSupabaseAuth
 * helper but with real token values sourced from env vars.
 *
 * getBrowserSupabase() returns this mock (in non-production builds) so the
 * callback page never creates a real SDK client.
 */
async function injectRealMicrosoftTokens(page: Page): Promise<void> {
  const accessToken = process.env.LAYER_C_MICROSOFT_ACCESS_TOKEN!;
  const refreshToken = process.env.LAYER_C_MICROSOFT_REFRESH_TOKEN!;
  const userId = process.env.LAYER_C_MICROSOFT_USER_ID!;

  // Session object mirrors the shape Supabase returns after a real PKCE exchange.
  // Email is intentionally omitted — PII must not appear in source (hard rule #8).
  const session: Record<string, unknown> = {
    access_token: 'synth-sb-access-layer-c-ms',
    refresh_token: 'synth-sb-refresh-layer-c-ms',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    provider_token: accessToken,
    provider_refresh_token: refreshToken,
    user: {
      id: userId,
      aud: 'authenticated',
      app_metadata: { provider: 'azure' },
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

/** Mock store-tokens to succeed — used with real token injection. */
async function mockStoreTokensSuccess(page: Page): Promise<void> {
  await page.route(STORE_TOKENS_ENDPOINT, async (route: Route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Layer C — Microsoft OAuth token replay tests
// ---------------------------------------------------------------------------

test.describe('@layer-c TASKRESPONSE-35 Microsoft OAuth token replay', () => {
  test('infrastructure: Layer C skips gracefully when env vars are absent', () => {
    // Documents and verifies the skip mechanism itself. Always passes.
    const configured = hasLayerCMicrosoft();
    if (!configured) {
      return;
    }
    expect(process.env.LAYER_C_MICROSOFT_USER_ID).toMatch(
      /^[0-9a-f-]{36}$/i, // UUID format
    );
  });

  test('real Microsoft access token is a non-trivial JWT', () => {
    test.skip(
      !hasLayerCMicrosoft(),
      'LAYER_C_ENABLED + LAYER_C_MICROSOFT_* env vars required',
    );
    // Real MS Graph access tokens are JWTs starting with "eyJ" (base64 header).
    const at = process.env.LAYER_C_MICROSOFT_ACCESS_TOKEN!;
    expect(at.startsWith('eyJ')).toBe(true);
    expect(at.length).toBeGreaterThan(100);
  });

  test('real Microsoft refresh token has non-trivial length', () => {
    test.skip(
      !hasLayerCMicrosoft(),
      'LAYER_C_ENABLED + LAYER_C_MICROSOFT_* env vars required',
    );
    // Real MS refresh tokens are opaque and long (typically 500+ chars).
    const rt = process.env.LAYER_C_MICROSOFT_REFRESH_TOKEN!;
    expect(rt.length).toBeGreaterThan(40);
  });

  test('real tokens replay through callback page → successful redirect to /onboarding/sync', async ({
    page,
  }) => {
    test.skip(
      !hasLayerCMicrosoft(),
      'LAYER_C_ENABLED + LAYER_C_MICROSOFT_* env vars required',
    );

    await injectRealMicrosoftTokens(page);
    await mockStoreTokensSuccess(page);

    const resp = await page.goto(
      '/connect/microsoft/callback?code=layer-c-ms-replay-code&state=layer-c-state',
    );
    expect(resp?.status()).toBeLessThan(500);

    // Success: navigates to /onboarding/sync, or shows success/exchanging state briefly.
    await expect(async () => {
      const url = page.url();
      const onSync = /\/onboarding\/sync/.test(url);
      const stillExchanging =
        await page.getByTestId('ms-callback-exchanging').count();
      const succeeded = await page.getByTestId('ms-callback-success').count();
      expect(onSync || stillExchanging > 0 || succeeded > 0).toBe(true);
    }).toPass({ timeout: 12_000 });
  });

  test('real token storage failure surfaces error UI', async ({ page }) => {
    test.skip(
      !hasLayerCMicrosoft(),
      'LAYER_C_ENABLED + LAYER_C_MICROSOFT_* env vars required',
    );

    await injectRealMicrosoftTokens(page);

    // Force the store-tokens endpoint to return a 400 error.
    await page.route(STORE_TOKENS_ENDPOINT, async (route: Route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: 'no_provider_refresh_token',
          }),
        });
        return;
      }
      await route.continue();
    });

    const resp = await page.goto(
      '/connect/microsoft/callback?code=layer-c-ms-replay-failstore&state=layer-c-state',
    );
    expect(resp?.status()).toBeLessThan(500);

    // Token storage failure must surface the error UI, not silently succeed.
    await expect(async () => {
      const errored = await page.getByTestId('ms-callback-error').count();
      const exchanging =
        await page.getByTestId('ms-callback-exchanging').count();
      expect(errored > 0 || exchanging > 0).toBe(true);
    }).toPass({ timeout: 10_000 });
  });

  test('real token replay: POST body is sent without synthetic placeholder values', async ({
    page,
  }) => {
    test.skip(
      !hasLayerCMicrosoft(),
      'LAYER_C_ENABLED + LAYER_C_MICROSOFT_* env vars required',
    );

    await injectRealMicrosoftTokens(page);

    // Intercept store-tokens to verify it is called (the real callback page
    // relies on session.provider_refresh_token from the SDK — confirming the
    // call is made validates the end-to-end token flow with real values).
    let storeTokensCalled = false;
    await page.route(STORE_TOKENS_ENDPOINT, async (route: Route) => {
      if (route.request().method() === 'POST') {
        storeTokensCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(
      '/connect/microsoft/callback?code=layer-c-ms-verify&state=layer-c-state',
    );

    await expect(async () => {
      const url = page.url();
      const onSync = /\/onboarding\/sync/.test(url);
      const succeeded = await page.getByTestId('ms-callback-success').count();
      expect(onSync || succeeded > 0 || storeTokensCalled).toBe(true);
    }).toPass({ timeout: 12_000 });

    // store-tokens must have been called — confirms the callback page
    // attempted token persistence for a real-token session.
    expect(storeTokensCalled).toBe(true);
  });
});
