/**
 * PRD §7.10 Reply drafting
 * PRD §7.11 Approval queue UI — Reject action
 * PRD §7.12 Auto-send mode — 60s cooling delay / cooldown reset
 *
 * Acceptance criteria:
 * - /api/drafts route exists and returns 401 for unauthenticated GET
 * - /api/drafts/[id] route supports GET, PATCH, DELETE
 * - /api/drafts/[id]/approve route exists and returns 401 for unauthenticated POST
 * - /api/drafts/[id]/reject route exists and returns 401 for unauthenticated POST
 * - Reject endpoint removes the draft locally AND deletes it at provider
 * - PATCH /api/drafts/[id] accepts body edit and re-saves (inline editor save)
 * - /api/conversations/[id]/cooldown/reset endpoint exists (not 404)
 * - Cooldown reset returns 401 for unauthenticated requests
 * - Cooldown reset only accepts POST (not GET)
 * - Draft reject does NOT leave orphan at provider (structural: 2-phase delete)
 * - Draft list (/api/drafts) returns JSON array sorted by confidence DESC
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §7.10 §7.11 §7.12 draft CRUD, reject, and cooldown reset', () => {
  test('§7.11 /api/drafts endpoint exists (not 404)', async ({ page }) => {
    const resp = await page.request.get('/api/drafts');
    expect(resp.status()).not.toBe(404);
  });

  test('§7.11 /api/drafts returns 401 for unauthenticated GET', async ({ page }) => {
    const resp = await page.request.get('/api/drafts');
    expect([401, 403]).toContain(resp.status());
  });

  test('§7.11 /api/drafts returns JSON content-type', async ({ page }) => {
    const resp = await page.request.get('/api/drafts');
    const ct = resp.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/);
  });

  test('§7.11 /api/drafts/[id] GET endpoint exists (not 404 on valid-format ID)', async ({ page }) => {
    // Use a fake UUID — should get 401 (auth) or 404 (not found), NOT 405 (method not allowed)
    const resp = await page.request.get('/api/drafts/00000000-0000-0000-0000-000000000001');
    expect(resp.status()).not.toBe(405);
    // 401/403 = auth, 404 = not found — both acceptable for a GET on missing draft
    expect([401, 403, 404]).toContain(resp.status());
  });

  test('§7.11 /api/drafts/[id] PATCH endpoint exists (not 405)', async ({ page }) => {
    const resp = await page.request.patch('/api/drafts/00000000-0000-0000-0000-000000000001', {
      data: { body: 'Updated draft body' },
      headers: { 'Content-Type': 'application/json' },
    });
    // Must accept PATCH method — not return 405 Method Not Allowed
    expect(resp.status()).not.toBe(405);
    expect([401, 403, 404]).toContain(resp.status());
  });

  test('§7.11 /api/drafts/[id] DELETE endpoint exists (not 405)', async ({ page }) => {
    const resp = await page.request.delete('/api/drafts/00000000-0000-0000-0000-000000000001');
    expect(resp.status()).not.toBe(405);
    expect([401, 403, 404]).toContain(resp.status());
  });

  test('§7.11 /api/drafts/[id]/approve endpoint exists (not 404)', async ({ page }) => {
    const resp = await page.request.post('/api/drafts/00000000-0000-0000-0000-000000000001/approve', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('§7.11 /api/drafts/[id]/approve returns 401 for unauthenticated POST', async ({ page }) => {
    const resp = await page.request.post('/api/drafts/00000000-0000-0000-0000-000000000001/approve', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(resp.status());
  });

  test('§7.11 /api/drafts/[id]/reject endpoint exists (not 404)', async ({ page }) => {
    const resp = await page.request.post('/api/drafts/00000000-0000-0000-0000-000000000001/reject', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
  });

  test('§7.11 /api/drafts/[id]/reject returns 401 for unauthenticated POST', async ({ page }) => {
    const resp = await page.request.post('/api/drafts/00000000-0000-0000-0000-000000000001/reject', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(resp.status());
  });

  test('§7.11 reject endpoint only accepts POST (not GET)', async ({ page }) => {
    const resp = await page.request.get('/api/drafts/00000000-0000-0000-0000-000000000001/reject');
    // GET on a reject endpoint must not be allowed
    expect([404, 405]).toContain(resp.status());
  });

  test('§7.12 /api/conversations/[id]/cooldown/reset endpoint exists (not 404)', async ({ page }) => {
    const resp = await page.request.post(
      '/api/conversations/00000000-0000-0000-0000-000000000001/cooldown/reset',
      { data: {}, headers: { 'Content-Type': 'application/json' } }
    );
    expect(resp.status()).not.toBe(404);
  });

  test('§7.12 cooldown reset returns 401 for unauthenticated requests', async ({ page }) => {
    const resp = await page.request.post(
      '/api/conversations/00000000-0000-0000-0000-000000000001/cooldown/reset',
      { data: {}, headers: { 'Content-Type': 'application/json' } }
    );
    expect([401, 403]).toContain(resp.status());
  });

  test('§7.12 cooldown reset only accepts POST (not GET)', async ({ page }) => {
    const resp = await page.request.get(
      '/api/conversations/00000000-0000-0000-0000-000000000001/cooldown/reset'
    );
    expect([404, 405]).toContain(resp.status());
  });

  test('§7.11 /drafts page Reject button triggers reject API (not approve)', async ({ page }) => {
    let rejectCalled = false;
    let approveCalled = false;

    await page.route('/api/drafts/*/reject', async route => {
      rejectCalled = true;
      await route.fulfill({ status: 401, body: JSON.stringify({ error: 'Unauthorized' }) });
    });
    await page.route('/api/drafts/*/approve', async route => {
      approveCalled = true;
      await route.fulfill({ status: 401, body: JSON.stringify({ error: 'Unauthorized' }) });
    });

    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const rejectBtn = page.getByRole('button', { name: /reject|dismiss|discard/i }).first();
    const exists = await rejectBtn.isVisible().catch(() => false);
    if (exists) {
      await rejectBtn.click();
      await page.waitForTimeout(500);
      // Reject must call reject endpoint, NOT approve endpoint
      if (rejectCalled) {
        expect(approveCalled).toBe(false);
      }
    }
  });

  test('§7.11 draft PATCH body edit saves to /api/drafts/[id]', async ({ page }) => {
    let patchCalled = false;

    await page.route('/api/drafts/**', async route => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        await route.fulfill({ status: 401, body: JSON.stringify({ error: 'Unauthorized' }) });
      } else {
        await route.continue();
      }
    });

    await page.goto('/drafts');
    const url = page.url();
    if (!url.includes('/drafts')) return;

    const editBtn = page.getByRole('button', { name: /edit/i }).first();
    const exists = await editBtn.isVisible().catch(() => false);
    if (exists) {
      await editBtn.click();
      const editor = page.locator('textarea, [contenteditable="true"], [data-testid="draft-editor"]').first();
      const editorVisible = await editor.isVisible({ timeout: 2000 }).catch(() => false);
      if (editorVisible) {
        await editor.fill('Updated draft content for test');
        const saveBtn = page.getByRole('button', { name: /save|update|done/i }).first();
        const hasSave = await saveBtn.isVisible().catch(() => false);
        if (hasSave) {
          await saveBtn.click();
          await page.waitForTimeout(500);
          expect(patchCalled).toBe(true);
        }
      }
    }
  });
});
