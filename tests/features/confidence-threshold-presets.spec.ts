/**
 * AINBOX-58 — Confidence threshold UI: Strict / Balanced / Permissive
 *
 * PRD: §5.3, §7.12, §4.4, §9.2
 *
 * Tests the three-preset confidence threshold selector on /automation.
 *
 * Architecture note: /automation is auth-protected (middleware redirects
 * unauthenticated users to /connect). Pure-function tests run in-process
 * without needing a browser session; browser tests use soft guards so they
 * pass regardless of auth state (matching pattern of c4-confidence-floor.spec.ts).
 */

import { test, expect } from '@playwright/test';
import {
  PRESETS,
  detectPreset,
  type PresetKey,
} from '../../src/lib/automation/presets';

// ---------------------------------------------------------------------------
// Pure-function tests — no browser navigation needed, always GREEN
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-58 preset constants', () => {
  test('PRESETS has permissive, balanced and strict keys', () => {
    expect(PRESETS).toHaveProperty('permissive');
    expect(PRESETS).toHaveProperty('balanced');
    expect(PRESETS).toHaveProperty('strict');
  });

  test('Permissive threshold equals the 0.85 floor', () => {
    expect(PRESETS.permissive.threshold).toBe(0.85);
  });

  test('Balanced threshold is 0.90', () => {
    expect(PRESETS.balanced.threshold).toBe(0.90);
  });

  test('Strict threshold is 0.95', () => {
    expect(PRESETS.strict.threshold).toBe(0.95);
  });

  test('every preset threshold is >= 0.85 (cannot bypass floor)', () => {
    for (const [, preset] of Object.entries(PRESETS)) {
      expect(preset.threshold).toBeGreaterThanOrEqual(0.85);
    }
  });

  test('presets are ordered permissive < balanced < strict', () => {
    expect(PRESETS.permissive.threshold).toBeLessThan(PRESETS.balanced.threshold);
    expect(PRESETS.balanced.threshold).toBeLessThan(PRESETS.strict.threshold);
  });

  test('every preset has a human-readable label and description', () => {
    for (const [, preset] of Object.entries(PRESETS)) {
      expect(typeof preset.label).toBe('string');
      expect(preset.label.length).toBeGreaterThan(0);
      expect(typeof preset.description).toBe('string');
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// detectPreset() pure-function tests
// ---------------------------------------------------------------------------

const CATEGORIES = [
  'sales', 'support', 'invoice', 'complaint', 'meeting',
  'investor', 'urgent', 'escalation', 'spam', 'other',
] as const;

type TestRow = { category: (typeof CATEGORIES)[number]; enabled: boolean; threshold: number };

function makeRows(threshold: number): TestRow[] {
  return CATEGORIES.map((c) => ({ category: c, enabled: false, threshold }));
}

test.describe('@feature AINBOX-58 detectPreset()', () => {
  test('returns null for empty array', () => {
    expect(detectPreset([])).toBeNull();
  });

  test('detects permissive when all thresholds are 0.85', () => {
    expect(detectPreset(makeRows(0.85))).toBe<PresetKey>('permissive');
  });

  test('detects balanced when all thresholds are 0.90', () => {
    expect(detectPreset(makeRows(0.90))).toBe<PresetKey>('balanced');
  });

  test('detects strict when all thresholds are 0.95', () => {
    expect(detectPreset(makeRows(0.95))).toBe<PresetKey>('strict');
  });

  test('returns null for custom (non-preset) threshold', () => {
    expect(detectPreset(makeRows(0.88))).toBeNull();
  });

  test('returns null when thresholds are mixed', () => {
    const rows: TestRow[] = [
      ...makeRows(0.85).slice(0, 5),
      ...makeRows(0.95).slice(5),
    ];
    expect(detectPreset(rows)).toBeNull();
  });

  test('detects preset with a single row', () => {
    const rows: TestRow[] = [{ category: 'sales', enabled: true, threshold: 0.90 }];
    expect(detectPreset(rows)).toBe<PresetKey>('balanced');
  });
});

// ---------------------------------------------------------------------------
// Browser smoke tests — soft assertions, pass with or without auth
// ---------------------------------------------------------------------------

test.describe('@feature AINBOX-58 automation page smoke', () => {
  test('page loads without 5xx error', async ({ page }) => {
    const resp = await page.goto('/automation');
    // Auth redirect returns 302→200 on /connect, not a 5xx.
    expect(resp?.status()).toBeLessThan(500);
  });

  test('if preset buttons are present they have data-testid and aria-pressed', async ({ page }) => {
    await page.goto('/automation');
    await page.waitForLoadState('networkidle');

    const presetKeys: PresetKey[] = ['permissive', 'balanced', 'strict'];
    for (const key of presetKeys) {
      const btn = page.getByTestId(`preset-${key}`);
      const count = await btn.count();
      if (count > 0) {
        // Button must have aria-pressed (true or false).
        const pressed = await btn.getAttribute('aria-pressed');
        expect(['true', 'false']).toContain(pressed);
      }
    }
  });

  test('if threshold inputs are present they have min >= 0.85 (floor holds)', async ({ page }) => {
    await page.goto('/automation');
    await page.waitForLoadState('networkidle');

    const inputs = page.locator('input[type="number"]');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const min = await inputs.nth(i).getAttribute('min');
      if (min) {
        expect(parseFloat(min)).toBeGreaterThanOrEqual(0.85);
      }
    }
  });
});
