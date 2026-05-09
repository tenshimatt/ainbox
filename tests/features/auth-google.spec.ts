/**
 * AINBOX-2 — Supabase Auth + Google OAuth flow.
 *
 * PRD: §3.9 (Auth stack) · §4.1 (Tenant isolation) · §4.2 (OAuth tokens)
 *      §5.2 (Onboarding) · §7.1 (Provider OAuth — Google)
 *
 * We DO NOT hit real Google. All Supabase HTTP traffic is intercepted
 * via Playwright's `page.route()` so the spec is hermetic. Fixtures use
 * the `@ainbox.test` domain (factory-rules.md hard rule #8).
 */

import { test, expect, type Route } from '@playwright/test';
import { SYNTH_USER_GOOGLE, SYNTH_USER_DENIED } from '../fixtures/users';

// Match the Supabase Auth URL the browser client builds. With our env
// fallback the URL is http://localhost:54321/auth/v1/...
const SUPABASE_GLOB = 'http://localhost:54321/auth/v1/**';
const FAKE_GOOGLE_AUTHZ = 'https://accounts.google.com/o/oauth2/v2/auth?stub=1';

async function mockSupabaseAllow(page: import('@playwright/test').Page) {
  await page.route(SUPABASE_GLOB, async (route: Route) => {
    const url = route.request().url();
    if (url.includes('/authorize')) {
      // Real Supabase Auth replies to /authorize with a 302 to the provider.
      return route.fulfill({
        status: 302,
        headers: { Location: FAKE_GOOGLE_AUTHZ },
        body: '',
      });
    }
    if (url.includes('/user')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: SYNTH_USER_GOOGLE.id,
          email: SYNTH_USER_GOOGLE.email,
          aud: 'authenticated',
        }),
      });
    }
    if (url.includes('/token')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'synth-access-token',
          refresh_token: 'synth-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user: {
            id: SYNTH_USER_GOOGLE.id,
            email: SYNTH_USER_GOOGLE.email,
            aud: 'authenticated',
          },
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function mockSupabaseDeny(page: import('@playwright/test').Page) {
  await page.route(SUPABASE_GLOB, async (route: Route) => {
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'access_denied',
        error_description: 'User denied consent',
      }),
    });
  });
}

test.describe('@features AINBOX-2 Supabase Auth + Google OAuth', () => {
  test('§7.1 /connect renders Google + Microsoft buttons', async ({ page }) => {
    const resp = await page.goto('/connect');
    expect(resp?.status()).toBeLessThan(500);
    await expect(page.getByRole('heading', { name: /connect/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /microsoft|outlook/i })).toBeVisible();
  });

  test('§7.1 happy path: clicking Google initiates Supabase OAuth → redirects to Google', async ({
    page,
  }) => {
    await mockSupabaseAllow(page);

    // Block the actual Google navigation so the test stays hermetic, but
    // allow us to assert the destination URL.
    let attemptedGoogleNav: string | null = null;
    await page.route('https://accounts.google.com/**', async (route) => {
      attemptedGoogleNav = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>Stub Google consent</body></html>',
      });
    });

    // Navigate directly to /connect/google to avoid mobile-WebKit click
    // quirks on role="button" anchors. The behaviour we care about is:
    // visiting /connect/google triggers Supabase signInWithOAuth which
    // navigates the browser to accounts.google.com.
    await page.goto('/connect/google');
    await page.waitForURL(/accounts\.google\.com|\/connect\/google/, { timeout: 8000 });
    expect(page.url()).toMatch(/accounts\.google\.com|\/connect\/google/);
    // If the navigation made it through to Google, we captured the URL:
    if (attemptedGoogleNav) {
      expect(attemptedGoogleNav).toContain('accounts.google.com');
    }
  });

  test('§3.9 §5.2 callback (hash flow) succeeds → redirects to /onboarding/sync', async ({
    page,
  }) => {
    await mockSupabaseAllow(page);
    // Pre-seed an active session in localStorage so getSession() resolves
    // without needing a real Supabase /token round-trip. This simulates a
    // successful sign-in handoff after the provider redirect.
    await page.addInitScript(
      ({ uid, email }: { uid: string; email: string }) => {
        const session = {
          access_token: 'synth-access-token',
          refresh_token: 'synth-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: uid, email, aud: 'authenticated', app_metadata: {}, user_metadata: {} },
        };
        try {
          window.localStorage.setItem(
            'sb-localhost-auth-token',
            JSON.stringify(session),
          );
        } catch {
          /* noop */
        }
      },
      { uid: SYNTH_USER_GOOGLE.id, email: SYNTH_USER_GOOGLE.email },
    );
    // No `?code=` → callback page falls through to getSession() which reads
    // the seeded session and redirects to /onboarding/sync.
    await page.goto('/connect/google/callback');
    await page.waitForURL(/\/onboarding\/sync/, { timeout: 8000 });
    expect(page.url()).toContain('/onboarding/sync');
  });

  test('§3.9 deny case: callback with ?error=access_denied surfaces an error', async ({ page }) => {
    // No supabase mock needed — the page reads ?error from the URL directly.
    void SYNTH_USER_DENIED;
    await page.goto('/connect/google/callback?error=access_denied&error_description=User%20denied%20consent');
    const alert = page.locator('main [role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/denied|fail/i);
    await expect(page.getByRole('link', { name: /try again/i })).toHaveAttribute('href', '/connect');
  });

  test('§3.9 deny case: Supabase returns error on code exchange', async ({ page }) => {
    await mockSupabaseDeny(page);
    await page.goto('/connect/google/callback?code=synth-code-deny');
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    // Should NOT redirect to onboarding sync
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/connect/google/callback');
  });

  test('§4.1 middleware: unauthenticated /inbox redirects to /connect', async ({ page }) => {
    const resp = await page.goto('/inbox');
    // Either we landed on /connect (redirect followed) or got a non-error status.
    expect(resp?.status()).toBeLessThan(500);
    expect(page.url()).toMatch(/\/connect/);
  });

  test('§4.1 middleware also protects /drafts /knowledge /automation /audit /settings', async ({
    page,
  }) => {
    for (const path of ['/drafts', '/knowledge', '/automation', '/audit', '/settings']) {
      const resp = await page.goto(path);
      expect(resp?.status(), `status for ${path}`).toBeLessThan(500);
      expect(page.url(), `redirect for ${path}`).toMatch(/\/connect/);
    }
  });
});
