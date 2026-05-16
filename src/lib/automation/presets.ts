/**
 * Confidence threshold presets for /automation (AINBOX-58).
 * Extracted from the page file so they can be exported cleanly —
 * Next.js App Router pages cannot export custom symbols.
 *
 * PRD: §7.25, §4.4, §9.2
 */

export const PRESETS = {
  permissive: { label: 'Permissive', threshold: 0.85, description: 'Send when confidence ≥ 85% — highest volume.' },
  balanced:   { label: 'Balanced',   threshold: 0.90, description: 'Send when confidence ≥ 90% — recommended.' },
  strict:     { label: 'Strict',     threshold: 0.95, description: 'Send when confidence ≥ 95% — lowest risk.' },
} as const;

export type PresetKey = keyof typeof PRESETS;

export interface CategoryRowLike {
  threshold: number;
}

/** Returns the matching preset key if ALL rows share the same threshold, else null. */
export function detectPreset(rows: CategoryRowLike[]): PresetKey | null {
  if (rows.length === 0) return null;
  const t = rows[0].threshold;
  if (!rows.every((r) => r.threshold === t)) return null;
  for (const [key, p] of Object.entries(PRESETS) as [PresetKey, (typeof PRESETS)[PresetKey]][]) {
    if (p.threshold === t) return key;
  }
  return null;
}
