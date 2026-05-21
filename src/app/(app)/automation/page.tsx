'use client';

/**
 * /automation — per-category auto-send config.
 *
 * PRD: §5.3, §7.12, §4.4, §9.2
 * Threshold floor 0.85 enforced in form (third defence layer; DB CHECK
 * + API route + this UI). Min attribute on the input is 0.85.
 */

import { useEffect, useState } from 'react';
import { PRESETS, detectPreset, type PresetKey } from '@/lib/automation/presets';

const CATEGORIES = [
  'sales',
  'support',
  'invoice',
  'complaint',
  'meeting',
  'investor',
  'urgent',
  'escalation',
  'spam',
  'other',
] as const;

type Category = (typeof CATEGORIES)[number];

interface CategoryRow {
  category: Category;
  enabled: boolean;
  threshold: number;
}

const FLOOR = 0.85;

export default function AutomationPage() {
  const [rows, setRows] = useState<CategoryRow[]>(() =>
    CATEGORIES.map((c) => ({ category: c, enabled: false, threshold: FLOOR })),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/automation', { credentials: 'include' });
        if (!res.ok) {
          // Page must still render for unauthenticated users (mobile-first smoke).
          if (!cancelled) setLoading(false);
          return;
        }
        const data = await res.json();
        if (cancelled || !Array.isArray(data.categories)) return;
        const incoming = new Map<string, CategoryRow>();
        for (const r of data.categories as CategoryRow[]) {
          incoming.set(r.category, r);
        }
        setRows(
          CATEGORIES.map((c) =>
            incoming.get(c) ?? { category: c, enabled: false, threshold: FLOOR },
          ),
        );
      } catch {
        // Swallow — surface "not signed in" only if explicitly needed.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateRow = (cat: Category, patch: Partial<CategoryRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.category === cat ? { ...r, ...patch } : r)),
    );
  };

  const handleSave = async () => {
    setError(null);
    setMessage(null);
    // Client-side floor enforcement (§9.2 hard floor).
    for (const r of rows) {
      if (r.threshold < FLOOR || r.threshold > 1) {
        setError(
          `Threshold for "${r.category}" must be between ${FLOOR} and 1.0.`,
        );
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch('/api/automation', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categories: rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status})`);
      } else {
        setMessage('Saved.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-full px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-2">Automation</h1>
      <p className="text-sm text-gray-600 mb-6">
        Auto-send rules per category. Confidence threshold floor is{' '}
        <strong>{FLOOR}</strong> (cannot be lowered). Drafts are dispatched
        after a 60-second cooling delay so you can intercept from the inbox.
      </p>

      {/* Preset selector — AINBOX-58 */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Quick presets</p>
        <div className="flex flex-wrap gap-3" role="group" aria-label="Confidence threshold presets">
          {(Object.entries(PRESETS) as [PresetKey, (typeof PRESETS)[PresetKey]][]).map(([key, preset]) => {
            const active = !loading && detectPreset(rows) === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={`preset-${key}`}
                aria-pressed={active}
                disabled={loading}
                onClick={() =>
                  setRows((prev) =>
                    prev.map((r) => ({ ...r, threshold: preset.threshold })),
                  )
                }
                className={`flex flex-col items-start rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-40 ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                }`}
              >
                <span className="text-sm font-semibold">{preset.label}</span>
                <span className={`mt-0.5 text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <form
          data-testid="automation-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="space-y-3"
        >
          <ul className="border rounded-md divide-y">
            {rows.map((row) => (
              <li
                key={row.category}
                data-testid={`row-${row.category}`}
                className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3"
              >
                <span className="font-medium capitalize sm:w-32">
                  {row.category}
                </span>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid={`toggle-${row.category}`}
                    checked={row.enabled}
                    onChange={(e) =>
                      updateRow(row.category, { enabled: e.target.checked })
                    }
                  />
                  Auto-send enabled
                </label>
                <label className="flex items-center gap-2 text-sm sm:ml-auto">
                  Threshold
                  <input
                    type="number"
                    data-testid={`threshold-${row.category}`}
                    min={FLOOR}
                    max={1}
                    step={0.01}
                    value={row.threshold}
                    onChange={(e) =>
                      updateRow(row.category, {
                        threshold: Number(e.target.value),
                      })
                    }
                    className="w-20 border rounded px-2 py-1"
                  />
                </label>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              data-testid="save-button"
              disabled={saving}
              className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {message && (
              <span data-testid="save-message" className="text-sm text-green-700">
                {message}
              </span>
            )}
            {error && (
              <span data-testid="save-error" className="text-sm text-red-700">
                {error}
              </span>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
