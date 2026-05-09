import Link from 'next/link';

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
      <p className="mt-2 text-sm text-slate-500">Internal admin tools</p>

      <div className="mt-8 space-y-3">
        <Link
          href="/admin/health"
          className="block rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50"
        >
          <h2 className="text-sm font-semibold text-slate-900">Sync Health</h2>
          <p className="mt-1 text-sm text-slate-500">Monitor per-tenant sync status and errors</p>
        </Link>
      </div>
    </main>
  );
}
