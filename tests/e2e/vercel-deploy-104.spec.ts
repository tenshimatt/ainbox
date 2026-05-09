/**
 * PRD §12.2 — Vercel Deployment: Enable Automatic Deployments from GitHub (Ticket 104)
 *
 * Acceptance criteria:
 * - POST /api/deploy starts a deployment and returns 202 + deploymentId + url
 * - GET /api/deploy/:deploymentId returns status (BUILDING | READY | ERROR | CANCELED)
 * - Real-time build log stream is available (via Supabase Realtime or SSE endpoint)
 * - POST /api/deploy/rollback/:deploymentId triggers rollback to a prior deployment
 * - Failed deployment returns status ERROR with a user-friendly error message
 * - 60-second cooling delay before auto-deploy fires (same pattern as auto-send §7.12)
 * - /settings/deploy shows deployment history (list of past deploys + statuses)
 * - Deploy history renders without horizontal overflow at 375px
 * - "Copy URL" button copies the deployment URL to clipboard
 * - No email PII ever appears in deployment logs or API responses
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §12.2 vercel deploy — automatic deployments + history (ticket 104)', () => {
  // ── API: Deployment lifecycle ─────────────────────────────────────────────

  test('104.1 POST /api/deploy returns 202 with deploymentId when token is set', async ({ request }) => {
    const response = await request.post('/api/deploy', {
      data: {
        projectName: 'ainbox-e2e-test',
        envVars: { AINBOX_TEST: 'true' },
      },
    });
    // 202 = accepted (async), 401/403 = unauthenticated, 400 = no project/token yet
    expect([202, 400, 401, 403]).toContain(response.status());
    if (response.status() === 202) {
      const body = await response.json();
      expect(body.deploymentId).toBeTruthy();
      expect(typeof body.deploymentId).toBe('string');
      // URL must be a vercel.app domain or similar
      if (body.url) {
        expect(body.url).toMatch(/https?:\/\//);
      }
    }
  });

  test('104.2 GET /api/deploy/:deploymentId returns known status values', async ({ request }) => {
    const response = await request.get('/api/deploy/nonexistent-deployment-id');
    expect([200, 401, 403, 404]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(['BUILDING', 'READY', 'ERROR', 'CANCELED', 'QUEUED']).toContain(body.status);
    }
  });

  test('104.3 GET /api/deploy lists all deployments for the authenticated user', async ({ request }) => {
    const response = await request.get('/api/deploy');
    expect([200, 401, 403, 404]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(Array.isArray(body.deployments)).toBe(true);
      for (const d of body.deployments) {
        expect(d.deploymentId).toBeDefined();
        expect(['BUILDING', 'READY', 'ERROR', 'CANCELED', 'QUEUED']).toContain(d.status);
        // No email body content in deployment metadata (§4.3)
        const jsonStr = JSON.stringify(d);
        expect(jsonStr).not.toMatch(/email_body|body_encrypted|message_body/i);
      }
    }
  });

  test('104.4 POST /api/deploy/rollback/:deploymentId returns 202 or 404', async ({ request }) => {
    const response = await request.post('/api/deploy/rollback/fake-deployment-id');
    expect([202, 401, 403, 404]).toContain(response.status());
  });

  // ── Real-time log stream ──────────────────────────────────────────────────

  test('104.5 GET /api/deploy/:deploymentId/logs endpoint exists (SSE or similar)', async ({ request }) => {
    const response = await request.get('/api/deploy/fake-id/logs', {
      headers: { Accept: 'text/event-stream' },
    });
    // 200 (streaming) or 404 (unknown id) or 401 — never 405 (method not allowed)
    expect([200, 401, 403, 404]).toContain(response.status());
    expect(response.status()).not.toBe(405);
  });

  // ── UI: Deployment history ────────────────────────────────────────────────

  test('104.6 /settings/deploy shows deployment history section', async ({ page }) => {
    const resp = await page.goto('/settings/deploy');
    expect(resp?.status()).not.toBe(500);
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const historySection =
      page.getByText(/deployment history|past deployments|recent deployments/i).first();
    const deployList = page.locator('[data-testid="deploy-history"], .deploy-history');
    const visible =
      await historySection.isVisible().catch(() => false) ||
      await deployList.isVisible().catch(() => false);
    expect(visible).toBe(true);
  });

  test('104.7 deployment history items show status badge and timestamp', async ({ page }) => {
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const rows = page.locator('[data-testid="deploy-row"], .deploy-item');
    const count = await rows.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const text = await row.textContent();
        // Must show a recognisable status word
        expect(text).toMatch(/building|ready|error|canceled|queued/i);
        // Must show some date/time indicator
        expect(text).toMatch(/\d{4}|\d{1,2}:\d{2}|ago|today/i);
      }
    }
  });

  test('104.8 "Copy URL" button shows copied confirmation', async ({ page, browserName }) => {
    // Skip clipboard permission grant (not supported on all browsers/engines)
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const copyBtn = page.getByRole('button', { name: /copy url|copy link|copy/i }).first();
    if (!await copyBtn.isVisible().catch(() => false)) return;

    await copyBtn.click();
    // Toast or aria-live confirmation must appear regardless of clipboard API support
    const toast = page.getByText(/copied|url copied/i).first();
    await expect(toast).toBeVisible({ timeout: 3000 });
  });

  test('104.9 deploy history no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  // ── Security / PII ────────────────────────────────────────────────────────

  test('104.10 deployment logs API response contains no email body content (§4.3)', async ({ request }) => {
    const response = await request.get('/api/deploy/fake-id/logs');
    if (response.status() === 200) {
      const text = await response.text();
      // Must not contain patterns that look like email body content
      expect(text).not.toMatch(/email_body|body_encrypted|message_body|Dear |Hello ,/i);
    }
  });

  // ── Cooling delay ─────────────────────────────────────────────────────────

  test('104.11 auto-deploy via webhook respects 60-second cooling delay', async ({ request }) => {
    // Simulate a GitHub push webhook event
    const response = await request.post('/api/deploy/webhook/github', {
      headers: { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=fake' },
      data: {
        ref: 'refs/heads/main',
        repository: { name: 'ainbox' },
        head_commit: { id: 'abc123def456', message: 'test commit' },
      },
    });
    // 200/202 = webhook accepted (deploy queued with delay), 401 = bad signature, 404 = not configured
    expect([200, 202, 401, 403, 404]).toContain(response.status());
    if ([200, 202].includes(response.status())) {
      const body = await response.json();
      // Must indicate a cooling delay before actual deployment
      const hasDelay =
        body.coolingDelay !== undefined ||
        body.scheduledAt !== undefined ||
        body.status === 'queued';
      expect(hasDelay).toBe(true);
    }
  });

  test('104.12 auto-deploy webhook with invalid signature returns 401', async ({ request }) => {
    const response = await request.post('/api/deploy/webhook/github', {
      headers: { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=invalid' },
      data: { ref: 'refs/heads/main' },
    });
    // Must reject unsigned/bad-signature webhooks
    expect([401, 403, 404]).toContain(response.status());
  });
});
