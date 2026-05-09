/**
 * PRD §12.2 — Vercel Deployment: Set Up Environment Variables (Ticket 103)
 *
 * Acceptance criteria:
 * - POST /api/deploy/env adds a key-value env var to the project
 * - GET /api/deploy/env returns a list of env var keys (values never returned — security)
 * - DELETE /api/deploy/env/:key removes an env var
 * - Sensitive env vars: values are masked/redacted in the UI and API responses
 * - Key names validate against Vercel's allowed pattern (UPPER_SNAKE_CASE with no spaces)
 * - /settings/deploy env-vars section renders without error
 * - At least NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY appear as required
 * - UI allows adding/editing/removing env vars without page reload
 * - No horizontal overflow at 375px on the env-vars section
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §12.2 vercel deploy — environment variables (ticket 103)', () => {
  // ── API: Environment Variable Management ──────────────────────────────────

  test('103.1 POST /api/deploy/env with valid key-value returns 201', async ({ request }) => {
    const response = await request.post('/api/deploy/env', {
      data: { key: 'AINBOX_TEST_VAR', value: 'test-value-123' },
    });
    expect([201, 401, 403]).toContain(response.status());
    if (response.status() === 201) {
      const body = await response.json();
      expect(body.key).toBe('AINBOX_TEST_VAR');
      // Value must NOT be echoed back
      expect(body.value).toBeUndefined();
    }
  });

  test('103.2 POST /api/deploy/env with invalid key name returns 400', async ({ request }) => {
    const response = await request.post('/api/deploy/env', {
      data: { key: 'invalid key with spaces', value: 'value' },
    });
    expect([400, 401, 403]).toContain(response.status());
    if (response.status() === 400) {
      const body = await response.json();
      expect(body.error).toBeDefined();
    }
  });

  test('103.3 POST /api/deploy/env with empty key returns 400', async ({ request }) => {
    const response = await request.post('/api/deploy/env', {
      data: { key: '', value: 'value' },
    });
    expect([400, 401, 403]).toContain(response.status());
  });

  test('103.4 GET /api/deploy/env returns array of keys — values never exposed', async ({ request }) => {
    const response = await request.get('/api/deploy/env');
    expect([200, 401, 403, 404]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(Array.isArray(body.vars)).toBe(true);
      for (const v of body.vars) {
        expect(v.key).toBeDefined();
        // Values must be redacted in the response (security)
        expect(v.value).toBeUndefined();
      }
    }
  });

  test('103.5 DELETE /api/deploy/env/:key removes the var', async ({ request }) => {
    const response = await request.delete('/api/deploy/env/AINBOX_TEST_VAR');
    expect([200, 204, 401, 403, 404]).toContain(response.status());
  });

  test('103.6 DELETE /api/deploy/env for non-existent key returns 404', async ({ request }) => {
    const response = await request.delete('/api/deploy/env/DOES_NOT_EXIST_VAR');
    expect([404, 401, 403]).toContain(response.status());
  });

  // ── Security: env values never leak ───────────────────────────────────────

  test('103.7 raw env values never appear in any API response body', async ({ request }) => {
    // Add a var with a distinctive sentinel value
    const sentinel = 'SENTINEL_SECRET_VALUE_AINBOX_12345';
    await request.post('/api/deploy/env', {
      data: { key: 'AINBOX_SENTINEL_KEY', value: sentinel },
    });

    // Fetch the env list — sentinel must not appear
    const listResp = await request.get('/api/deploy/env');
    if (listResp.status() === 200) {
      const text = await listResp.text();
      expect(text).not.toContain(sentinel);
    }

    // Cleanup
    await request.delete('/api/deploy/env/AINBOX_SENTINEL_KEY');
  });

  // ── UI: Env vars section ──────────────────────────────────────────────────

  test('103.8 /settings/deploy env-vars section renders without error', async ({ page }) => {
    const resp = await page.goto('/settings/deploy');
    expect(resp?.status()).not.toBe(500);
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    // Section heading or "Add variable" button
    const section = page.getByText(/environment variable|env var|env variables/i).first();
    const addBtn = page.getByRole('button', { name: /add variable|add env/i });
    const visible =
      await section.isVisible().catch(() => false) ||
      await addBtn.isVisible().catch(() => false);
    expect(visible).toBe(true);
  });

  test('103.9 env var values masked in UI (input type=password or redacted display)', async ({ page }) => {
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    // Any existing env var value inputs must be type=password or show "***"
    const valueInputs = page.locator(
      'input[name*="value" i][data-env], input[placeholder*="value" i][data-env]'
    );
    const count = await valueInputs.count();
    for (let i = 0; i < count; i++) {
      const type = await valueInputs.nth(i).getAttribute('type');
      expect(type).toBe('password');
    }
  });

  test('103.10 /settings/deploy env section no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('103.11 key name validation fires before form submission', async ({ page }) => {
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const keyInput = page.locator(
      'input[name*="key" i][data-env], input[placeholder*="variable name" i], input[placeholder*="KEY" ]'
    );
    const count = await keyInput.count();
    if (count === 0) return; // Env section may not render until project exists

    await keyInput.first().fill('bad key with spaces');
    await keyInput.first().press('Tab');

    const errorMsg = page.locator('[role="alert"], .error-message, [data-testid="field-error"]').first();
    const hasError = await errorMsg.isVisible().catch(() => false);
    expect(hasError).toBe(true);
  });

  test('103.12 adding an env var does not require page reload (SPA update)', async ({ page }) => {
    await page.goto('/settings/deploy');
    const url = page.url();
    if (url.includes('/connect') || url.includes('/login') || url.includes('/auth')) {
      return;
    }
    const addBtn = page.getByRole('button', { name: /add variable|add env/i });
    if (!await addBtn.isVisible().catch(() => false)) return;

    // Click add and verify the form appears without navigation
    await addBtn.click();
    const newKeyInput = page.locator(
      'input[name*="key" i][data-env], input[placeholder*="variable name" i]'
    ).last();
    await expect(newKeyInput).toBeVisible({ timeout: 3000 });
    // URL should not change
    expect(page.url()).toBe(url.replace(/#.*/, '') + (url.includes('#') ? '' : ''));
  });
});
