'use client';

import { useEffect, useState } from 'react';

type SyncState = {
  provider?: string;
  status: string;
  error?: string;
  permanent?: boolean;
  failed_at?: string;
  retry_after_seconds?: number;
  next_retry_at?: string;
  attempt?: number;
};

export default function AdminHealthPage() {
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sync/status')
      .then(r => r.json())
      .then(data => {
        setSyncStates(Array.isArray(data) ? data : [data]);
      })
      .catch(() => {
        setSyncStates([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const hasFailure = syncStates.some(s => s.status === 'failed' || s.permanent);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">System Health</h1>
      <p className="mt-1 text-sm text-slate-500">Per-tenant email sync status and error monitoring</p>

      <section
        data-testid="sync-health"
        aria-label="Sync status"
        className="mt-8 rounded-lg border border-slate-200 bg-white p-6"
      >
        <h2 className="text-base font-semibold text-slate-800">Sync status</h2>

        {loading && (
          <p className="mt-4 text-sm text-slate-500">Loading sync status...</p>
        )}

        {!loading && syncStates.length === 0 && (
          <p className="mt-4 text-sm text-slate-500">No sync state data available.</p>
        )}

        {!loading && syncStates.length > 0 && (
          <div className="mt-4 space-y-3">
            {syncStates.map((s, i) => (
              <div
                key={i}
                role={s.status === 'failed' || s.permanent ? 'alert' : undefined}
                data-testid={s.status === 'failed' || s.permanent ? 'health-alert' : 'health-status'}
                className={`rounded-md border p-4 ${
                  s.status === 'failed' || s.permanent
                    ? 'border-red-200 bg-red-50'
                    : s.status === 'rate_limited'
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-green-200 bg-green-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-800">
                    {s.provider ?? 'Provider'}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      s.status === 'failed' || s.permanent
                        ? 'bg-red-100 text-red-700'
                        : s.status === 'rate_limited'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                {s.error && (
                  <p className="mt-1 text-sm text-red-700">
                    Error: {s.error}
                    {s.permanent && ' — reconnect required'}
                  </p>
                )}
                {s.status === 'failed' && !s.error && (
                  <p className="mt-1 text-sm text-red-700">Sync failed — please reconnect your account</p>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && !hasFailure && syncStates.length > 0 && (
          <p className="mt-4 text-sm text-green-700">All sync providers are healthy.</p>
        )}
      </section>
    </main>
  );
}
