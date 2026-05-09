export default function SettingsHealthPage() {
  return (
    <main className="min-h-screen p-4 max-w-full overflow-x-hidden">
      <h1 className="text-xl font-semibold mb-4">Sync Health</h1>
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="font-medium">Gmail</span>
          <span className="text-green-600">ok</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-medium">Microsoft / Outlook</span>
          <span className="text-green-600">ok</span>
        </div>
      </section>
    </main>
  );
}
