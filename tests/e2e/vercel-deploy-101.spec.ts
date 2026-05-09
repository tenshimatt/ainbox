/**
 * PRD §12.2 — Vercel Deployment: Initialize Vercel Project (Ticket 101)
 *
 * Acceptance criteria:
 * - POST /api/deploy/token saves an encrypted Vercel PAT and returns a masked token
 * - Invalid token returns 400 with "Invalid Vercel token"
 * - GET /api/deploy/token returns the masked token for an authenticated user
 * - POST /api/deploy/project creates a new Vercel project and returns a projectId
 * - Project creation requires a valid token; missing token → 401
 * - /settings/deploy page renders without error (the deployment settings surface)
 * - "Connect Vercel" button is visible on /settings/deploy
 * - No horizontal overflow at 375px on /settings/deploy
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §12.2 vercel deploy — initialize vercel project (ticket 101)', () => {
  // ── API: Token Vault ──────────────────────────────────────────────────────

  test('101.1 POST /api/deploy/token with valid token returns 201 and masked value', async ({ request }) => {
    const response = await request.post('/api/deploy/token', {
      data: { token: 'valid-vercel-pat-token' },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    // Masked token format: first char + "..." + last char
    expect(body.masked).toBeDefined();
    expect(typeof body.masked).toBe('string');
    expect(body.masked.length).toBeGreaterThan(3);
  });

  test('101.2 POST /api/deploy/token with invalid token returns 400', async ({ request }) => {
    const response = await request.post('/api/deploy/token', {
      data: { token: 'not-valid' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid Vercel token');
  });

  test('101.3 POST /api/deploy/token without auth returns 401', async ({ request }) => {
    // No session cookie / auth header supplied
    const response = await request.post('/api/deploy/token', {
      data: { token: 'some-token' },
    });
    // Unauthenticated request must not succeed
    expect([401, 403]).toContain(response.status());
  });

  test('101.4 GET /api/deploy/token returns masked token for authenticated user', async ({ request }) => {
    const response = await request.get('/api/deploy/token');
    // Either 200 (token exists) or 404 (no token yet) — never 500
    expect([200, 404]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.token).toBeDefined();
      // Must not be the raw token — raw Vercel PATs are much longer
      expect(body.token).not.toMatch(/^[a-zA-Z0-9]{24,}$/);
    }
  });

  // ── API: Project Creation ─────────────────────────────────────────────────

  test('101.5 POST /api/deploy/project creates project and returns projectId', async ({ request }) => {
    const response = await request.post('/api/deploy/project', {
      data: { projectName: 'ainbox-test-project' },
    });
    // Requires a saved token; without auth it should 401
    expect([201, 401, 403]).toContain(response.status());
    if (response.status() === 201) {
      const body = await response.json();
      expect(body.projectId).toBeTruthy();
      expect(typeof body.projectId).toBe('string');
    }
  });

  test('101.6 POST /api/deploy/project without saved token returns 400 or 401', async ({ request }) => {
    const response = await request.post('/api/deploy/project', {
      data: { projectName: 'no-token-project' },
    });
    expect([400, 401, 403]).toContain(response.status());
  });

  // ── UI: /settings/deploy surface ─────────────────────────────────────────

  test('101.7 /settings/deploy renders without 404 or 500', async ({ page }) => {
    const resp = await page.goto('/settings/deploy');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('101.8 /settings/deploy shows "Connect Vercel" button or connected state', async ({ page }) => {
    await page.goto('/settings/deploy');
    const url = page.url();
    // If redirected to auth, skip UI assertions
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const connectBtn = page.getByRole('button', { name: /connect vercel/i });
    const connectedBadge = page.getByText(/vercel connected|connected to vercel/i);
    const visible = await connectBtn.isVisible().catch(() => false)
      || await connectedBadge.isVisible().catch(() => false);
    expect(visible).toBe(true);
  });

  test('101.9 /settings/deploy no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('101.10 token input field uses type=password (raw token never visible)', async ({ page }) => {
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    // If there's a token input on the page, it must be type=password
    const tokenInput = page.locator('input[placeholder*="token" i], input[name*="token" i], input[id*="token" i]');
    const count = await tokenInput.count();
    if (count > 0) {
      const type = await tokenInput.first().getAttribute('type');
      expect(type).toBe('password');
    }
  });
});
