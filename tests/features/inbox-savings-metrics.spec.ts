/**
 * TASK7544-9 — Hours saved + money saved metrics on dashboard
 *
 * Verifies via source-code inspection (auth-wall prevents browser navigation
 * to /inbox in test environments — same pattern as settings-version-badge.spec.ts):
 *  - SavingsMetrics component exists with correct testids and structure
 *  - Inbox page imports SavingsMetrics and passes sentDraftCount
 *  - Calculation constants (4 min/email, $35/hr) are encoded correctly
 *  - No horizontal overflow class missing (w-full max-w-full on panel)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');

function readSrc(rel: string) {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

test.describe('@feature TASK7544-9 inbox savings metrics', () => {
  test('SavingsMetrics component file exists', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src.length).toBeGreaterThan(0);
  });

  test('SavingsMetrics has savings-metrics testid on wrapper', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src).toContain('data-testid="savings-metrics"');
  });

  test('SavingsMetrics has hours-saved-card testid', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src).toContain('data-testid="hours-saved-card"');
  });

  test('SavingsMetrics has money-saved-card testid', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src).toContain('data-testid="money-saved-card"');
  });

  test('SavingsMetrics has hours-saved-value testid', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src).toContain('data-testid="hours-saved-value"');
  });

  test('SavingsMetrics has money-saved-value testid', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src).toContain('data-testid="money-saved-value"');
  });

  test('SavingsMetrics uses 4 minutes per email constant', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src).toContain('MINUTES_PER_EMAIL = 4');
  });

  test('SavingsMetrics uses $35/hr rate constant', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src).toContain('HOURLY_RATE_USD = 35');
  });

  test('SavingsMetrics panel has overflow-safe width classes', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    // w-full + max-w-full prevents horizontal overflow (mobile-first rule)
    expect(src).toContain('w-full');
    expect(src).toContain('max-w-full');
  });

  test('SavingsMetrics has aria-label for accessibility', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src).toContain('aria-label');
  });

  test('SavingsMetrics accepts sentDraftCount prop', () => {
    const src = readSrc('src/components/inbox/SavingsMetrics.tsx');
    expect(src).toContain('sentDraftCount');
  });

  test('inbox page imports SavingsMetrics', () => {
    const src = readSrc('src/app/(app)/inbox/page.tsx');
    expect(src).toContain("import SavingsMetrics from '@/components/inbox/SavingsMetrics'");
  });

  test('inbox page renders SavingsMetrics with sentDraftCount', () => {
    const src = readSrc('src/app/(app)/inbox/page.tsx');
    expect(src).toContain('<SavingsMetrics sentDraftCount={sentDraftCount}');
  });

  test('inbox page fetches sentDraftCount from drafts table', () => {
    const src = readSrc('src/app/(app)/inbox/page.tsx');
    expect(src).toContain('sentDraftCount');
    // Must query the drafts table with status=sent
    expect(src).toContain("eq('status', 'sent')");
  });

  test('inbox page uses count:exact head query for sentDraftCount', () => {
    const src = readSrc('src/app/(app)/inbox/page.tsx');
    expect(src).toContain("count: 'exact'");
    expect(src).toContain('head: true');
  });
});
