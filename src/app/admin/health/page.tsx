export default function AdminHealthPage() {
  return (
    <main className="min-h-screen p-4 max-w-full overflow-x-hidden">
      <h1 className="text-xl font-semibold mb-4">System Health</h1>
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="font-medium">Gmail Sync</span>
          <span className="text-green-600">connected</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-medium">Outlook Sync</span>
          <span className="text-green-600">connected</span>
        </div>
      </section>
    </main>
  );
}
