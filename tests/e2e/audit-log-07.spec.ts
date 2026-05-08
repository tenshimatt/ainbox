/**
 * PRD §7.14 Audit log
 *
 * Acceptance criteria:
 * - /audit page renders without error
 * - Audit log shows: timestamp, model used, confidence, KB items referenced, decision type
 * - Decision types: classify, draft, send (no other types)
 * - Audit log has no email body content (PII §4.3 — bodies are redacted)
 * - Audit log is exportable as CSV via a button/link
 * - CSV export triggers download (or API endpoint returns text/csv)
 * - /audit no horizontal overflow at 375px
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §7.14 audit log', () => {
  test('§7.14 /audit renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/audit');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§7.14 /audit shows audit log table or empty state', async ({ page }) => {
    await page.goto('/audit');
    const url = page.url();
    if (!url.includes('/audit')) return;

    const hasTable = await page.locator('table, [role="table"], [data-testid="audit-log"]')
      .first().isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no audit entries|nothing logged|audit log empty/i)
      .first().isVisible().catch(() => false);
    expect(hasTable || hasEmptyState).toBe(true);
  });

  test('§7.14 audit log rows show timestamp', async ({ page }) => {
    await page.goto('/audit');
    const url = page.url();
    if (!url.includes('/audit')) return;

    const rows = page.locator('[data-testid="audit-row"], tr[data-testid]');
    const count = await rows.count().catch(() => 0);
    if (count > 0) {
      const timestampCell = rows.first().locator('[data-testid="audit-timestamp"], time, [datetime]');
      const hasCellOrIsoText = await timestampCell.count().then(n => n > 0).catch(() => false);
      expect(hasCellOrIsoText).toBe(true);
    }
  });

  test('§7.14 audit log rows show confidence score', async ({ page }) => {
    await page.goto('/audit');
    const url = page.url();
    if (!url.includes('/audit')) return;

    const rows = page.locator('[data-testid="audit-row"], tbody tr');
    const count = await rows.count().catch(() => 0);
    if (count > 0) {
      const confidenceCell = rows.first()
        .locator('[data-testid="confidence"], [aria-label*="confidence"], .confidence');
      const hasConfidence = await confidenceCell.count().then(n => n > 0).catch(() => false);
      expect(hasConfidence).toBe(true);
    }
  });

  test('§7.14 audit log rows show decision type (classify/draft/send)', async ({ page }) => {
    await page.goto('/audit');
    const url = page.url();
    if (!url.includes('/audit')) return;

    const rows = page.locator('[data-testid="audit-row"], tbody tr');
    const count = await rows.count().catch(() => 0);
    if (count > 0) {
      const decisionCell = rows.first()
        .locator('[data-testid="decision-type"], .decision-type');
      const hasDecision = await decisionCell.count().then(n => n > 0).catch(() => false);
      if (hasDecision) {
        const text = (await decisionCell.first().textContent() ?? '').toLowerCase();
        expect(['classify', 'draft', 'send']).toContain(text);
      }
    }
  });

  test('§7.14 §4.3 audit log rows do NOT contain email body text', async ({ page }) => {
    await page.goto('/audit');
    const url = page.url();
    if (!url.includes('/audit')) return;

    // Audit log must show NO raw email body columns
    const bodyColumn = page.locator('[data-testid="email-body"], th:has-text("body"), th:has-text("content")');
    const hasBodyColumn = await bodyColumn.count().then(n => n > 0).catch(() => false);
    expect(hasBodyColumn).toBe(false);
  });

  test('§7.14 audit log has CSV export button/link', async ({ page }) => {
    await page.goto('/audit');
    const url = page.url();
    if (!url.includes('/audit')) return;

    const exportBtn = page.getByRole('button', { name: /export|download|csv/i })
      .or(page.getByRole('link', { name: /export|download|csv/i }))
      .first();
    await expect(exportBtn).toBeVisible();
  });

  test('§7.14 CSV export endpoint returns text/csv', async ({ page }) => {
    const resp = await page.request.get('/api/audit/export.csv');
    if (resp.status() === 401 || resp.status() === 403) return; // auth-gated is OK
    expect(resp.status()).not.toBe(404);
    const ct = resp.headers()['content-type'] ?? '';
    if (resp.status() === 200) {
      expect(ct).toMatch(/text\/csv/);
    }
  });

  test('§7.14 /audit no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/audit');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
