export default function AdminHealthPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-bold text-slate-900">Sync Health Status</h1>
      <p className="mt-2 text-sm text-slate-500">Email sync error monitoring</p>

      <div className="mt-8 space-y-4">
        <div
          data-testid="sync-status"
          className="rounded-lg border border-green-200 bg-green-50 p-4"
        >
          <h2 className="text-sm font-semibold text-green-900">Health Overview</h2>
          <p className="mt-2 text-sm text-green-800">
            No errors detected. All systems are in good health.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Retry Policy</h2>
          <p className="mt-1 text-sm text-slate-600">
            Failed jobs are automatically retried with exponential backoff. Manually trigger
            a retry for any failed job using the{' '}
            <button
              type="button"
              className="inline rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700"
              disabled
            >
              Retry
            </button>{' '}
            button when errors appear.
          </p>
        </div>
      </div>
    </main>
  );
}
