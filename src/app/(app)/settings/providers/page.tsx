'use client';

import { useState } from 'react';
import { MOCK_PROVIDERS } from '@/lib/mock-data';

export default function SettingsProvidersPage() {
  const [providers, setProviders] = useState(MOCK_PROVIDERS);
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null);

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
      <div className="mx-auto w-full max-w-full px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-slate-900">Providers</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your connected email accounts</p>

        <div className="mt-6 space-y-4">
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
                  <span className="text-xs text-slate-400">Not connected</span>
                )}
              </div>
            </div>
          ))}

          <h2 className="mt-8 text-sm font-semibold text-slate-700">Add another provider</h2>
          <div className="flex gap-3">
            <a
              href="/connect/google"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Connect Google
            </a>
            <a
              href="/connect/microsoft"
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
      </div>
    </>
  );
}
