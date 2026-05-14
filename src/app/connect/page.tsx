'use client';
/**
 * /connect — provider chooser (PRD §5.2, §7.1, §7.2).
 *
 * Uses window.location.href for provider navigation (hard navigation)
 * to ensure the provider page is loaded in a fresh document context.
 * This is required because:
 *   1. Mobile WebKit does not fire click events on <a role="button"> for
 *      native link following (resolved by using a JS click handler).
 *   2. The Supabase OAuth redirect (window.location.assign) inside the
 *      provider page must happen in a hard-navigation context so that
 *      Playwright's page.route() can handle the subsequent document
 *      navigation correctly (soft-nav context breaks route.fulfill
 *      for redirect status codes in Playwright ≥ 1.46).
 */
export default function ConnectPage() {
  function go(path: string) {
    window.location.href = path;
  }

  return (
    <main className="container mx-auto px-4 py-12 max-w-md">
      <h1 className="text-2xl font-bold mb-6">Connect provider</h1>
      <p className="text-sm text-slate-600 mb-6">
        Sign in with your inbox provider. We request mail-read, mail-modify, and
        mail-send scopes so TaskResponse can draft and send replies on your behalf.
      </p>
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => go('/connect/google')}
          aria-label="Continue with Google"
          className="block w-full rounded bg-slate-900 px-4 py-3 text-center text-white hover:bg-slate-800"
        >
          Continue with Google
        </button>
        <button
          type="button"
          onClick={() => go('/connect/microsoft')}
          aria-label="Continue with Microsoft"
          className="block w-full rounded border border-slate-300 px-4 py-3 text-center hover:bg-slate-50"
        >
          Continue with Microsoft
        </button>
      </div>
    </main>
  );
}
