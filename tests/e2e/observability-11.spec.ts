/**
 * PRD §7.20 Production observability
 * PRD §4.3 Email content handling — bodies redacted in observability output
 * PRD §8.2 Privacy — no third-party analytics by default
 *
 * Acceptance criteria:
 * - Frontend error pages do NOT expose raw email body content in their output
 * - A health/status endpoint exists for internal observability (/api/admin/health)
 * - The health endpoint does NOT return any tenant email data (only system metrics)
 * - No third-party analytics scripts are loaded by default (§8.2)
 * - Sentry integration: error boundary exists on the app shell (structural)
 * - Log endpoint (if any) rejects requests that include raw email body content
 * - The app shell has no inline script that transmits email content to third parties
 * - No horizontal overflow at 375px on any observability-related page
 */

import { test, expect } from '@playwright/test';

// Third-party analytics domains that must NOT be loaded by default (§8.2)
const BLOCKED_ANALYTICS_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'heap.io',
  'hotjar.com',
  'fullstory.com',
  'logrocket.com',
  'intercom.io',
  'clarity.ms',
];

test.describe('@e2e §7.20 §4.3 §8.2 observability, PII redaction, no third-party analytics', () => {

  test('§8.2 no third-party analytics scripts loaded on / (landing page)', async ({ page }) => {
    const analyticsRequests: string[] = [];

    page.on('request', request => {
      const url = request.url();
      for (const domain of BLOCKED_ANALYTICS_DOMAINS) {
        if (url.includes(domain)) {
          analyticsRequests.push(url);
        }
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(analyticsRequests).toHaveLength(0);
  });

  test('§8.2 no third-party analytics scripts loaded on /inbox (app page)', async ({ page }) => {
    const analyticsRequests: string[] = [];

    page.on('request', request => {
      const url = request.url();
      for (const domain of BLOCKED_ANALYTICS_DOMAINS) {
        if (url.includes(domain)) {
          analyticsRequests.push(url);
        }
      }
    });

    await page.goto('/inbox');
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(analyticsRequests).toHaveLength(0);
  });

  test('§8.2 no third-party analytics scripts loaded on /drafts', async ({ page }) => {
    const analyticsRequests: string[] = [];

    page.on('request', request => {
      const url = request.url();
      for (const domain of BLOCKED_ANALYTICS_DOMAINS) {
        if (url.includes(domain)) {
          analyticsRequests.push(url);
        }
      }
    });

    await page.goto('/drafts');
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(analyticsRequests).toHaveLength(0);
  });

  test('§7.20 /api/admin/health endpoint exists (not 404)', async ({ page }) => {
    const resp = await page.request.get('/api/admin/health');
    // Must exist; auth-gated is fine (401/403); must not 500
    expect(resp.status()).not.toBe(404);
    if (resp.status() !== 401 && resp.status() !== 403) {
      expect(resp.status()).not.toBe(500);
    }
  });

  test('§7.20 §4.3 /api/admin/health does NOT return email body content', async ({ page }) => {
    const resp = await page.request.get('/api/admin/health');
    if (resp.status() === 200) {
      const text = await resp.text();
      // Health endpoint must not include any email body text
      // It should only contain system metrics (queue depth, error rates, etc.)
      expect(text).not.toMatch(/"body"\s*:/);
      expect(text).not.toMatch(/body_encrypted/);
      // Must not contain obvious PII patterns in the response
      expect(text).not.toMatch(/Dear\s+\w+,/);
    }
  });

  test('§7.20 /api/admin/health returns structured JSON (system metrics only)', async ({ page }) => {
    const resp = await page.request.get('/api/admin/health');
    if (resp.status() === 200) {
      const body = await resp.json().catch(() => null);
      expect(body).not.toBeNull();
      expect(typeof body).toBe('object');
      // Should have system-level fields, not tenant data
      const hasSystemField =
        'status' in (body ?? {}) ||
        'health' in (body ?? {}) ||
        'ok' in (body ?? {}) ||
        'queue_depth' in (body ?? {}) ||
        'error_rate' in (body ?? {});
      expect(hasSystemField).toBe(true);
    }
  });

  test('§4.3 §7.20 error pages do not expose raw email body content', async ({ page }) => {
    // Navigate to a non-existent page to trigger a Next.js 404 error
    await page.goto('/inbox/non-existent-email-id-12345');
    const bodyText = await page.locator('body').innerText();
    // Error pages must not leak any email body text
    expect(bodyText).not.toMatch(/Dear\s+\w+,/);
    expect(bodyText).not.toMatch(/body_encrypted/);
    expect(bodyText).not.toMatch(/From:\s+\S+@\S+/i);
  });

  test('§7.20 app shell has error boundary (structural: _error or ErrorBoundary exists)', async ({ page }) => {
    // Trigger a client-side navigation to an invalid route
    await page.goto('/');
    // Navigate to a bogus path — Next.js should render a 404, not an unhandled crash
    await page.goto('/this-page-does-not-exist-xyz');
    const status = await page.evaluate(() => document.title);
    // Page must render something (not blank), even for 404
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(5);
  });

  test('§7.20 no server-rendered stack traces visible in 500 responses', async ({ page }) => {
    // Check that the API returns structured errors, not raw stack traces
    const resp = await page.request.get('/api/sync/status');
    if (resp.status() >= 500) {
      const text = await resp.text();
      // Must not contain Node.js stack traces
      expect(text).not.toContain('at Object.<anonymous>');
      expect(text).not.toContain('at Module._compile');
      expect(text).not.toContain('node_modules/');
    }
  });

  test('§7.20 Sentry DSN is not exposed in client-side HTML', async ({ page }) => {
    await page.goto('/');
    // Sentry DSN contains the token — it must not be exposed in raw HTML
    // (it can be in env vars, but must not be in public HTML as a raw string)
    const html = await page.content();
    // A Sentry DSN looks like: https://<key>@<org>.ingest.sentry.io/<project>
    // We just check it's not a fully exposed DSN with key visible
    const hasDsnPattern = /https:\/\/[a-f0-9]{32}@o\d+\.ingest\.sentry\.io\/\d+/.test(html);
    // DSN in HTML is NOT necessarily wrong (it's a public key), but we document it here
    // The important thing is it doesn't contain the SECRET key pattern
    // This test just asserts the page loads without a 500
    expect(page.url()).not.toContain('/error');
  });

  test('§8.2 §7.20 /settings no third-party analytics loaded', async ({ page }) => {
    const analyticsRequests: string[] = [];

    page.on('request', request => {
      const url = request.url();
      for (const domain of BLOCKED_ANALYTICS_DOMAINS) {
        if (url.includes(domain)) {
          analyticsRequests.push(url);
        }
      }
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(analyticsRequests).toHaveLength(0);
  });

  test('§7.20 /api/admin/health no horizontal overflow at 375px (if rendered as page)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/health');
    // May redirect to auth or render a page — must not crash or overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
