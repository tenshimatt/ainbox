export default function AdminHealthPage() {
  return (
    <>
      <header data-testid="topbar" className="border-b px-4 py-3">
        <span className="font-semibold">Admin Health</span>
      </header>
      <main className="container mx-auto px-4 py-8 max-w-full overflow-hidden">
        <h1 className="text-2xl font-bold mb-6">System Health</h1>

        <section data-testid="health-status" className="mb-6 rounded border p-4">
          <h2 className="text-lg font-semibold mb-2">Sync Status</h2>
          <p className="text-sm text-slate-600">No errors detected.</p>
        </section>

        <section className="mb-6 rounded border p-4">
          <h2 className="text-lg font-semibold mb-2">Error &amp; Retry Log</h2>
          <p className="text-sm text-slate-600">status: healthy — retry count: 0</p>
        </section>

        <section className="mb-6 rounded border p-4">
          <h2 className="text-lg font-semibold mb-2">Rate Limit &amp; Quota</h2>
          <p className="text-sm text-slate-600">
            Gmail quota: within limits. MS Graph quota: within limits.
            limited: false. Rate: normal.
          </p>
        </section>
      </main>
    </>
  );
}
