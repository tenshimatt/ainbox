'use client';

import { useEffect, useState } from 'react';

type Provider = {
  id: string;
  type: 'google' | 'microsoft';
  name: string;
  email: string | null;
  connected: boolean;
  connectedAt: string;
};

function relinkUrl(provider: Provider): string {
  return provider.type === 'google' ? '/connect/google' : '/connect/microsoft';
}

export default function SettingsProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/oauth/tokens', { credentials: 'include' });
      if (r.ok) {
        const data = (await r.json()) as { providers: Provider[] };
        setProviders(data.providers ?? []);
      }
    })();
  }, []);

  const handleDisconnect = async (providerId: string) => {
    try {
      const resp = await fetch(`/api/oauth/tokens/${providerId}`, { method: 'DELETE' });
      if (resp.ok) {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === providerId ? { ...p, connected: false } : p
          )
        );
      }
    } catch {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === providerId ? { ...p, connected: false } : p
        )
      );
    }
    setDisconnectConfirm(null);
  };

  return (
    <>
      <main className="mx-auto w-full max-w-full px-4 py-6 sm:px-6 lg:px-8">
        <header>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Providers</h1>
          <p className="mt-1 text-sm text-slate-500">Manage your connected email accounts</p>
        </header>

        <div className="mt-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">Connected Accounts</h2>

          {providers.length === 0 && (
            <p className="text-sm text-slate-500" data-testid="no-providers-message">
              No mailboxes connected yet. Add one below.
            </p>
          )}

          {providers.map((provider) => (
            <div
              key={provider.id}
              data-testid="provider-row"
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-600">
                  {provider.type === 'google' ? 'G' : 'M'}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">{provider.name}</p>
                  <p className="text-xs text-slate-500">{provider.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {provider.connected ? (
                  <>
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Connected
                    </span>
                    <button
                      onClick={() => setDisconnectConfirm(provider.id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1 text-xs text-amber-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      Disconnected
                    </span>
                    <a
                      href={relinkUrl(provider)}
                      data-testid="relink-button"
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    >
                      Re-link
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}

          <h2 className="mt-8 text-sm font-semibold text-slate-700">Add mailbox</h2>
          <div className="flex flex-wrap gap-3">
            <a
              href="/connect/google"
              data-testid="add-google"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Connect Google
            </a>
            <a
              href="/connect/microsoft"
              data-testid="add-microsoft"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Connect Microsoft
            </a>
          </div>
        </div>

        {/* Disconnect confirmation dialog */}
        {disconnectConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            role="dialog"
            aria-label="confirm disconnect"
          >
            <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-900">Disconnect provider?</h3>
              <p className="mt-2 text-sm text-slate-500">
                This will remove OAuth tokens for this provider. You can reconnect at any time.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setDisconnectConfirm(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDisconnect(disconnectConfirm)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
