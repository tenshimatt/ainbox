/**
 * /connect — provider chooser (PRD §5.2, §7.1, §7.2).
 *
 * Buttons navigate to per-provider entry routes which kick off the
 * Supabase Auth OAuth flow (PRD §3.9). We don't call signInWithOAuth
 * directly here — the e2e spec asserts on a navigation event.
 */
export default function ConnectPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-md">
      <h1 className="text-2xl font-bold mb-6">Connect provider</h1>
      <p className="text-sm text-slate-600 mb-6">
        Sign in with your inbox provider. We request mail-read, mail-modify, and
        mail-send scopes so Ainbox can draft and send replies on your behalf.
      </p>
      <div className="space-y-3">
        <a
          href="/connect/google"
          role="button"
          aria-label="Continue with Google"
          className="block rounded bg-slate-900 px-4 py-3 text-center text-white hover:bg-slate-800"
        >
          Continue with Google
        </a>
        <a
          href="/connect/microsoft"
          role="button"
          aria-label="Continue with Microsoft"
          className="block rounded border border-slate-300 px-4 py-3 text-center hover:bg-slate-50"
        >
          Continue with Microsoft
        </a>
      </div>
    </main>
  );
}
