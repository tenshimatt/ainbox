/**
 * PRD §13.2 OAuth scope / consent — regulatory compliance surface
 * DPA page at /legal/dpa — required for EU/UK production launch (PRD §11.2)
 *
 * Acceptance criteria:
 * - /legal/dpa renders without 404/500
 * - Page shows a heading referencing "Data Processing Agreement" or "DPA"
 * - Page names the Data Processor (Beyond Pandora Ltd or Ainbox)
 * - Page references GDPR Article 28
 * - Page lists sub-processors (Supabase, Vercel at minimum)
 * - Page provides a contact mechanism (email or form) for DPA requests
 * - Page is publicly accessible (no auth required)
 * - /legal/dpa no horizontal overflow at 375px
 * - Page does not contain any real email addresses of data subjects (§4.3)
 * - Page has a "Last updated" or version date
 */

import { test, expect } from '@playwright/test';

test.describe('@e2e §11.2 legal DPA page', () => {
  test('§11.2 /legal/dpa renders without 404/500', async ({ page }) => {
    const resp = await page.goto('/legal/dpa');
    expect(resp?.status()).not.toBe(404);
    expect(resp?.status()).not.toBe(500);
  });

  test('§11.2 /legal/dpa is publicly accessible (no auth redirect)', async ({ page }) => {
    const resp = await page.goto('/legal/dpa');
    expect(resp?.url()).toContain('/legal/dpa');
    // Should not redirect to /login or /connect
    expect(page.url()).not.toMatch(/\/login|\/connect|\/auth/);
  });

  test('§11.2 /legal/dpa shows a DPA heading', async ({ page }) => {
    await page.goto('/legal/dpa');
    const heading = page.getByRole('heading', {
      name: /data processing agreement|dpa/i,
    });
    await expect(heading).toBeVisible();
  });

  test('§11.2 /legal/dpa names the Data Processor', async ({ page }) => {
    await page.goto('/legal/dpa');
    const processorText = page.getByText(/beyond pandora|ainbox/i).first();
    await expect(processorText).toBeVisible();
  });

  test('§11.2 /legal/dpa references GDPR Article 28', async ({ page }) => {
    await page.goto('/legal/dpa');
    const gdprRef = page.getByText(/gdpr|article 28|regulation.*2016\/679/i).first();
    await expect(gdprRef).toBeVisible();
  });

  test('§11.2 /legal/dpa lists sub-processors (Supabase and Vercel)', async ({ page }) => {
    await page.goto('/legal/dpa');
    const supabase = page.getByText(/supabase/i).first();
    const vercel = page.getByText(/vercel/i).first();
    await expect(supabase).toBeVisible();
    await expect(vercel).toBeVisible();
  });

  test('§11.2 /legal/dpa provides a contact mechanism for DPA requests', async ({ page }) => {
    await page.goto('/legal/dpa');
    // Must have either a link (mailto: or contact form) or visible contact info
    const contactLink = page.locator('a[href^="mailto:"]').first();
    const contactText = page.getByText(/contact|request.*dpa|legal@/i).first();
    const hasContact = await Promise.any([
      contactLink.isVisible(),
      contactText.isVisible(),
    ]).catch(() => false);
    expect(hasContact).toBe(true);
  });

  test('§11.2 /legal/dpa shows a "Last updated" date', async ({ page }) => {
    await page.goto('/legal/dpa');
    const dateText = page.getByText(/last updated|updated:|version|effective/i).first();
    await expect(dateText).toBeVisible();
  });

  test('§4.3 /legal/dpa does not contain real data-subject email addresses', async ({ page }) => {
    await page.goto('/legal/dpa');
    const content = await page.locator('body').textContent();
    // Must not contain user/data-subject email addresses
    // Contact email for DPA requests is acceptable (it's the processor's contact)
    // We check there are no more than 1 email address (just the contact one)
    const matches = content?.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [];
    // At most 1 email (the processor contact address); no data-subject addresses
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  test('§11.2 /legal/dpa no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/legal/dpa');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('§11.2 /legal/dpa page renders within 2s', async ({ page }) => {
    const start = Date.now();
    await page.goto('/legal/dpa');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
