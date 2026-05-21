/**
 * TASK7544-1 — Pricing Page Free Trial Strategy
 *
 * Acceptance criteria:
 * - Starter and Pro tiers both show "Start free trial" CTA
 * - Starter and Pro tiers link to /connect with trial=true query param
 * - Business tier shows "Contact sales" (no trial)
 * - "14-day free trial" badge appears on Starter tier card
 * - "Includes 14-day free trial" sub-copy appears under Starter and Pro prices
 * - "No credit card required" appears beneath trial CTAs
 * - "How the free trial works" section (id="free-trial") with 3 steps is present
 * - Trial FAQ section (id="trial-faq") with at least 4 questions is present
 * - Primary "Start your free trial" CTA in the steps section links to /connect?trial=true
 * - Page is mobile-safe (no overflow at 375px)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PRICING_PAGE = path.join(
  __dirname,
  '../../src/app/pricing/page.tsx',
);

function readSource(): string {
  return fs.readFileSync(PRICING_PAGE, 'utf-8');
}

test.describe('@feature TASK7544-1 pricing page free trial strategy', () => {
  // ── Static source checks ────────────────────────────────────────────────

  test('Starter tier CTA is "Start free trial"', () => {
    const src = readSource();
    // Starter tier object has cta: 'Start free trial'
    expect(src).toContain("name: 'Starter'");
    expect(src).toContain("cta: 'Start free trial'");
  });

  test('Pro tier CTA is "Start free trial"', () => {
    const src = readSource();
    expect(src).toContain("name: 'Pro'");
    // Both Starter and Pro share the same CTA string
    const matches = (src.match(/cta: 'Start free trial'/g) ?? []).length;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  test('Business tier CTA is "Contact sales"', () => {
    const src = readSource();
    expect(src).toContain("cta: 'Contact sales'");
  });

  test('Starter and Pro ctaHref include trial=true', () => {
    const src = readSource();
    expect(src).toContain('trial=true');
    // At least two occurrences — Starter and Pro href
    const matches = (src.match(/trial=true/g) ?? []).length;
    expect(matches).toBeGreaterThanOrEqual(3); // starter href, pro href, steps CTA
  });

  test('"14-day free trial" badge aria-label on Starter card', () => {
    const src = readSource();
    expect(src).toContain('aria-label="14-day free trial included"');
  });

  test('"Includes 14-day free trial" sub-copy under price', () => {
    const src = readSource();
    expect(src).toContain('Includes 14-day free trial');
  });

  test('"No credit card required" appears under trial CTAs', () => {
    const src = readSource();
    expect(src).toContain('No credit card required');
  });

  test('TRIAL_STEPS array has 3 entries', () => {
    const src = readSource();
    expect(src).toContain('Connect your inbox');
    expect(src).toContain('AI starts learning');
    expect(src).toContain('Review drafts, go live');
  });

  test('free-trial section id present', () => {
    const src = readSource();
    expect(src).toContain('id="free-trial"');
  });

  test('trial-faq section id present', () => {
    const src = readSource();
    expect(src).toContain('id="trial-faq"');
  });

  test('TRIAL_FAQS has 4 entries covering key topics', () => {
    const src = readSource();
    expect(src).toContain('Do I need a credit card to start?');
    expect(src).toContain('What happens when the trial ends?');
    expect(src).toContain('Can I switch plans during the trial?');
    expect(src).toContain('Is the full feature set available in the trial?');
  });

  test('Business tier has trial: false', () => {
    const src = readSource();
    expect(src).toContain("trial: false");
  });

  // ── Runtime checks (iphone-15 project) ─────────────────────────────────

  test('§pricing page loads without 5xx', async ({ page }) => {
    const resp = await page.goto('/pricing');
    expect(resp?.status()).toBeLessThan(500);
  });

  test('§pricing h1 renders', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('§pricing "Start free trial" buttons are visible', async ({ page }) => {
    await page.goto('/pricing');
    const trialBtns = page.getByRole('link', { name: /start free trial/i });
    // At least Starter + Pro + steps CTA
    await expect(trialBtns.first()).toBeVisible();
    expect(await trialBtns.count()).toBeGreaterThanOrEqual(2);
  });

  test('§pricing "Contact sales" link is visible for Business tier', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('link', { name: /contact sales/i })).toBeVisible();
  });

  test('§pricing "14-day free trial" eyebrow chip is visible', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/14-day free trial/i).first()).toBeVisible();
  });

  test('§pricing free trial steps section is present', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { name: /Connect your inbox/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /AI starts learning/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Review drafts, go live/i })).toBeVisible();
  });

  test('§pricing FAQ section renders first question', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/Do I need a credit card/i)).toBeVisible();
  });

  test('§pricing no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/pricing');
    const bodyWidth = await page.locator('body').evaluate((el) => el.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});
