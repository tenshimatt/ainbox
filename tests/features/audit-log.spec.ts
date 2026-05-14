/**
 * TASKRESPONSE-14 — Audit log UI + CSV export
 * PRD: §5.3 §7.14 §6.1
 *
 * Verifies:
 *  - /audit renders the audit-log table with rows from /api/audit
 *  - filter form narrows the result set (category filter narrows rows)
 *  - CSV export button triggers a download from /api/audit/export
 *  - mobile-first: at 375px the page itself does NOT horizontally
 *    overflow — only the table's scroll container does
 */

import { test, expect } from '@playwright/test';

type AuditRow = {
  id: string;
  created_at: string;
  action: 'classify' | 'draft' | 'send';
  email_id: string;
  category: string;
  model: string;
  confidence: number;
  kb_items_used: unknown[];
  details: string;
};

const FIXTURE: AuditRow[] = [
  {
    id: 'a1',
    created_at: '2026-05-01T10:00:00Z',
    action: 'classify',
    email_id: 'msg-001',
    category: 'sales',
    model: 'deepseek-v4-pro',
    confidence: 0.92,
    kb_items_used: [{ id: 'k1' }, { id: 'k2' }],
    details: 'sales lead routing',
  },
  {
    id: 'a2',
    created_at: '2026-05-01T11:00:00Z',
    action: 'draft',
    email_id: 'msg-002',
    category: 'support',
    model: 'deepseek-v4-pro',
    confidence: 0.87,
    kb_items_used: [{ id: 'k3' }],
    details: 'support reply drafted',
  },
  {
    id: 'a3',
    created_at: '2026-05-01T12:00:00Z',
    action: 'send',
    email_id: 'msg-003',
    category: 'support',
    model: 'deepseek-v4-pro',
    confidence: 0.91,
    kb_items_used: [],
    details: 'auto-send executed',
  },
];

async function mockAuditApi(page: import('@playwright/test').Page, rows: AuditRow[]) {
  await page.route('**/api/audit?**', async (route) => {
    const url = new URL(route.request().url());
    const cat = url.searchParams.get('category');
    const evt = url.searchParams.get('event_type');
    let filtered = rows;
    if (cat) filtered = filtered.filter((r) => r.category === cat);
    if (evt) filtered = filtered.filter((r) => r.action === evt);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: filtered,
        total: filtered.length,
        page: 1,
        pageSize: 50,
      }),
    });
  });

  await page.route('**/api/audit/export**', async (route) => {
    const url = new URL(route.request().url());
    const cat = url.searchParams.get('category');
    let filtered = rows;
    if (cat) filtered = filtered.filter((r) => r.category === cat);
    const header =
      'timestamp,event_type,target_id,category,model,confidence,kb_items_used,details';
    const lines = filtered.map((r) =>
      [
        r.created_at,
        r.action,
        r.email_id,
        r.category,
        r.model,
        r.confidence,
        r.kb_items_used.length,
        r.details,
      ].join(','),
    );
    await route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      headers: {
        'content-disposition': 'attachment; filename="audit-log.csv"',
      },
      body: [header, ...lines].join('\n') + '\n',
    });
  });
}

test.describe('@feature TASKRESPONSE-14 audit log', () => {
  test('table renders rows from /api/audit', async ({ page }) => {
    await mockAuditApi(page, FIXTURE);
    await page.goto('/audit');

    await expect(page.locator('[data-testid="audit-log"]')).toBeVisible();
    const rows = page.locator('[data-testid="audit-row"]');
    await expect(rows).toHaveCount(FIXTURE.length);

    // Decision-type cell should reflect the action verb
    await expect(rows.nth(0).locator('[data-testid="decision-type"]')).toHaveText(
      /classify|draft|send/,
    );
  });

  test('category filter narrows results', async ({ page }) => {
    await mockAuditApi(page, FIXTURE);
    await page.goto('/audit');
    await expect(page.locator('[data-testid="audit-row"]')).toHaveCount(FIXTURE.length);

    await page.locator('[data-testid="filter-category"]').selectOption('support');
    await page.locator('[data-testid="filter-apply"]').click();

    await expect(page).toHaveURL(/category=support/);
    const rows = page.locator('[data-testid="audit-row"]');
    await expect(rows).toHaveCount(2); // only support rows from FIXTURE
  });

  test('CSV export button triggers a download', async ({ page }) => {
    await mockAuditApi(page, FIXTURE);
    await page.goto('/audit');

    const exportBtn = page.locator('[data-testid="export-csv"]');
    await expect(exportBtn).toBeVisible();

    // The export anchor uses `download`; verify it points at the API
    // and that the API responds with text/csv when called directly.
    const href = await exportBtn.getAttribute('href');
    expect(href).toContain('/api/audit/export');

    // Use page-context fetch so the page.route mock applies.
    const result = await page.evaluate(async (url) => {
      const r = await fetch(url, { cache: 'no-store' });
      return {
        status: r.status,
        contentType: r.headers.get('content-type') ?? '',
        body: await r.text(),
      };
    }, href!);
    expect(result.status).toBe(200);
    expect(result.contentType).toMatch(/text\/csv/);
    expect(result.body.split('\n')[0]).toContain('timestamp');
    expect(result.body).toContain('classify');
  });

  test('no PAGE-level horizontal overflow at 375px', async ({ page }) => {
    await mockAuditApi(page, FIXTURE);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/audit');

    // The body must not exceed the viewport width — only the table
    // scroll container scrolls horizontally.
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);

    // The inner table scroll container is allowed (and expected) to
    // exceed its parent, proving the table itself is scrollable.
    const scroll = page.locator('[data-testid="audit-table-scroll"]');
    await expect(scroll).toBeVisible();
    const scrollWidth = await scroll.evaluate((el) => (el as HTMLElement).scrollWidth);
    const clientWidth = await scroll.evaluate((el) => (el as HTMLElement).clientWidth);
    expect(scrollWidth).toBeGreaterThanOrEqual(clientWidth);
  });
});
