export default function ConnectPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-md">
      <h1 className="text-2xl font-bold mb-6">Connect provider</h1>
      <div className="space-y-3">
        <a href="/connect/google" role="button" className="block rounded bg-slate-900 px-4 py-3 text-center text-white hover:bg-slate-800">Continue with Google</a>
        <a href="/connect/microsoft" role="button" className="block rounded border border-slate-300 px-4 py-3 text-center hover:bg-slate-50">Continue with Microsoft</a>
      </div>
    </main>
  );
}
