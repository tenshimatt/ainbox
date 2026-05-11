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

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'providers' | 'account'>('providers');
  const [providers, setProviders] = useState<Provider[]>([]);
  useEffect(() => {
    (async () => {
      const r = await fetch('/api/oauth/tokens', { credentials: 'include' });
      if (r.ok) {
        const data = (await r.json()) as { providers: Provider[] };
        setProviders(data.providers ?? []);
      }
    })();
  }, []);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
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
      // offline mock — update UI anyway
      setProviders((prev) =>
        prev.map((p) =>
          p.id === providerId ? { ...p, connected: false } : p
        )
      );
    }
    setDisconnectConfirm(null);
  };

  const handleDeleteAccount = async () => {
    try {
      await fetch('/api/account/delete', { method: 'DELETE' });
    } catch {
      // offline mock
    }
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <div className="mx-auto w-full max-w-full px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your account and connected providers</p>

        {/* Tabs */}
        <div className="mt-6 border-b border-slate-200">
          <nav className="-mb-px flex gap-6" role="tablist">
            {[
              { id: 'providers' as const, label: 'Providers' },
              { id: 'account' as const, label: 'Account' },
            ].map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Providers tab */}
        {activeTab === 'providers' && (
          <div className="mt-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Connected Accounts</h2>
            {providers.map((provider) => (
              <div
                key={provider.id}
                data-testid="provider-row"
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg">
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

            <h2 className="mt-8 text-sm font-semibold text-slate-700">Add Provider</h2>
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
        )}

        {/* Account tab */}
        {activeTab === 'account' && (
          <div className="mt-6 space-y-6">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h2 className="text-sm font-semibold text-red-700">Danger Zone</h2>
              <p className="mt-1 text-xs text-red-600">
                Deleting your account will permanently remove all your data, including emails, drafts, knowledge base items, and automation rules. This cannot be undone.
              </p>
              <button
                onClick={() => setDeleteDialogOpen(true)}
                className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete everything
              </button>
            </div>
          </div>
        )}

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

        {/* Delete confirmation dialog */}
        {deleteDialogOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            role="alertdialog"
            aria-label="confirm delete account"
          >
            <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-900">Delete everything?</h3>
              <p className="mt-2 text-sm text-slate-500">
                This action permanently deletes all your data and cannot be undone. Are you sure?
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setDeleteDialogOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Delete my account
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
