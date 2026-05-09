'use client';

import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { MOCK_PROVIDERS } from '@/lib/mock-data';

export default function SettingsProvidersPage() {
  const [providers, setProviders] = useState(MOCK_PROVIDERS);
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null);
  const [emailScopeGranted, setEmailScopeGranted] = useState<boolean | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgrade_success') === '1') {
      setEmailScopeGranted(true);
      return;
    }
    // Check scope status for the first Google provider
    const googleProvider = MOCK_PROVIDERS.find(p => p.type === 'google' && p.connected);
    if (!googleProvider) return;
    fetch(`/api/v1/gmail/scope-status?connection_id=${googleProvider.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && typeof data.email_scope_granted === 'boolean') {
          setEmailScopeGranted(data.email_scope_granted);
        }
      })
      .catch(() => null);
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
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {emailScopeGranted === false && (
          <div
            role="alert"
            data-testid="gmail-scope-upgrade-banner"
            className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm text-amber-800">
              Grant inbox read permission to enable Gmail email access. Upgrade your Gmail scope to allow Ainbox to read your inbox.
            </p>
            <a
              data-testid="upgrade-scope-button"
              href="/connect/google?scope=gmail.readonly&upgrade=1"
              className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              Upgrade now
            </a>
          </div>
        )}
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
    </AppLayout>
  );
}
