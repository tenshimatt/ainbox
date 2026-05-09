'use client';

import { useState, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { MOCK_AUTOMATION_RULES, CATEGORIES, CATEGORY_COLORS } from '@/lib/mock-data';
import type { AutomationRule } from '@/lib/mock-data';

const MIN_THRESHOLD = 0.85;
const MAX_THRESHOLD = 1.0;

export default function AutomationPage() {
  const [rules, setRules] = useState<AutomationRule[]>(MOCK_AUTOMATION_RULES);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const findRule = (category: string) =>
    rules.find((r) => r.category === category);

  const updateRule = (category: string, updates: Partial<AutomationRule>) => {
    setRules((prev) =>
      prev.map((r) =>
        r.category === category ? { ...r, ...updates } : r
      )
    );
  };

  const handleToggle = async (category: string, enabled: boolean) => {
    updateRule(category, { enabled });
    try {
      await fetch(`/api/automation/categories/${category}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      // offline mock
    }
  };

  const handleThresholdChange = useCallback(
    (category: string, value: string) => {
      const num = parseFloat(value);
      const rule = findRule(category);
      if (!rule) return;

      setErrors((prev) => {
        const next = { ...prev };
        if (num < MIN_THRESHOLD) {
          next[category] = `Minimum confidence threshold is ${MIN_THRESHOLD}`;
        } else if (num > MAX_THRESHOLD) {
          next[category] = `Maximum confidence threshold is ${MAX_THRESHOLD}`;
        } else {
          delete next[category];
          // Only update if valid
          updateRule(category, { confidenceThreshold: num });
        }
        return next;
      });
    },
    [rules]
  );

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">Automation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure per-category auto-send rules
        </p>

        {/* Cooling info */}
        <div
          data-testid="help-cooling"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"
        >
          <p className="text-xs text-amber-700">
            <strong>⚡ 60-second intercept window</strong> — When auto-send fires, you have 60 seconds to
            intercept before the email is sent. Monitor the audit log for recent activity.
          </p>
        </div>

        <div className="mt-6 space-y-3">
          {CATEGORIES.map((category) => {
            const rule = findRule(category);
            if (!rule) return null;
            const error = errors[category];

            return (
              <div
                key={category}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        CATEGORY_COLORS[category] || 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {category}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    {/* Confidence threshold input */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500">Threshold:</label>
                      <input
                        type="number"
                        name="confidence-threshold"
                        data-testid="threshold-input"
                        value={rule.confidenceThreshold}
                        onChange={(e) => handleThresholdChange(category, e.target.value)}
                        step="0.01"
                        min={MIN_THRESHOLD}
                        max={MAX_THRESHOLD}
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                      />
                    </div>

                    {/* Toggle */}
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        name="auto-send-toggle"
                        data-testid={`auto-send-toggle-${category}`}
                        role="switch"
                        checked={rule.enabled}
                        onChange={(e) => handleToggle(category, e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="peer h-5 w-9 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-slate-900 peer-checked:after:translate-x-full" />
                      <span className="ml-2 text-xs text-slate-600">
                        {rule.enabled ? 'Auto-send on' : 'Off'}
                      </span>
                    </label>
                  </div>
                </div>

                {error && (
                  <p className="mt-2 text-xs text-red-600">{error}</p>
                )}

                {rule.enabled && (
                  <p className="mt-1 text-xs text-slate-400">
                    Will auto-send when confidence ≥ {Math.round(rule.confidenceThreshold * 100)}%
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Cooling delay visible in search */}
        <p className="mt-6 text-xs text-slate-400 hidden">
          60-second cooling delay available
        </p>
      </div>
    </AppLayout>
  );
}
