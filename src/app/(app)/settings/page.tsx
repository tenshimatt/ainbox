'use client';

import { useEffect, useState } from 'react';
import { SKILLS_LIBRARY, type Skill } from '@/lib/skills/skills';

type Provider = {
  id: string;
  type: 'google' | 'microsoft';
  name: string;
  email: string | null;
  connected: boolean;
  connectedAt: string;
};

type SkillRow = Skill & { enabled: boolean };

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'providers' | 'skills' | 'account'>('providers');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>(() =>
    SKILLS_LIBRARY.map((s) => ({ ...s, enabled: false })),
  );
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [skillsMessage, setSkillsMessage] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/oauth/tokens', { credentials: 'include' });
      if (r.ok) {
        const data = (await r.json()) as { providers: Provider[] };
        setProviders(data.providers ?? []);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/skills', { credentials: 'include' });
        if (!r.ok) return;
        const data = (await r.json()) as { skills: SkillRow[] };
        if (cancelled || !Array.isArray(data.skills)) return;
        const incoming = new Map(data.skills.map((s) => [s.id, s.enabled]));
        setSkills(SKILLS_LIBRARY.map((s) => ({ ...s, enabled: incoming.get(s.id) ?? false })));
      } catch {
        // best-effort — default to all disabled
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSkillToggle = (skillId: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === skillId ? { ...s, enabled: !s.enabled } : s)),
    );
    setSkillsMessage(null);
    setSkillsError(null);
  };

  const handleSkillsSave = async () => {
    setSkillsSaving(true);
    setSkillsMessage(null);
    setSkillsError(null);
    try {
      const resp = await fetch('/api/skills', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skills: skills.map((s) => ({ skill_id: s.id, enabled: s.enabled })) }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setSkillsError((data as { error?: string }).error ?? `Save failed (${resp.status})`);
      } else {
        setSkillsMessage('Saved.');
      }
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSkillsSaving(false);
    }
  };

  // ── Duplicate account detection (AINBOX-50) ──────────────────────────────
  type DuplicateAccount = { id: string; email: string; created_at: string };
  const [duplicates, setDuplicates] = useState<DuplicateAccount[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState<DuplicateAccount | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeSuccess, setMergeSuccess] = useState<string | null>(null);

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

  // Load duplicates whenever the user switches to the Account tab
  useEffect(() => {
    if (activeTab !== 'account') return;
    let cancelled = false;
    setDuplicatesLoading(true);
    setDuplicatesError(null);
    (async () => {
      try {
        const r = await fetch('/api/account/duplicates', { credentials: 'include' });
        if (cancelled) return;
        if (!r.ok) {
          setDuplicatesError("Couldn't check for duplicate accounts. Try refreshing.");
          return;
        }
        const data = (await r.json()) as { duplicates: DuplicateAccount[] };
        if (!cancelled) setDuplicates(data.duplicates ?? []);
      } catch {
        if (!cancelled) setDuplicatesError("Couldn't check for duplicate accounts. Try refreshing.");
      } finally {
        if (!cancelled) setDuplicatesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  const handleMerge = async (dup: DuplicateAccount) => {
    setMergeLoading(true);
    setMergeError(null);
    setMergeSuccess(null);
    try {
      const resp = await fetch('/api/account/merge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ duplicate_user_id: dup.id }),
      });
      if (!resp.ok) {
        setMergeError("Couldn't merge account. Try again.");
      } else {
        setDuplicates((prev) => prev.filter((d) => d.id !== dup.id));
        setMergeSuccess(`Merged successfully. Data from ${dup.email} has been consolidated.`);
      }
    } catch {
      setMergeError("Couldn't merge account. Try again.");
    } finally {
      setMergeLoading(false);
      setMergeConfirm(null);
    }
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
      <main className="mx-auto w-full max-w-full px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Settings</h1>
          <span
            data-testid="app-version-badge"
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
          >
            <span className="font-semibold text-slate-800">Ainbox</span>
            <span className="text-slate-400">v0.1.0</span>
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">Manage your account and connected providers</p>

        {/* Tabs */}
        <div className="border-b border-slate-200">
          <nav className="-mb-px flex gap-4 sm:gap-6" role="tablist">
            {[
              { id: 'providers' as const, label: 'Providers' },
              { id: 'skills' as const, label: 'Skills' },
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
            <div className="flex flex-wrap gap-3">
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

        {/* Skills tab */}
        {activeTab === 'skills' && (
          <div className="mt-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Writing Skills</h2>
              <p className="mt-1 text-xs text-slate-500">
                Toggle the writing behaviours you want applied to every AI-drafted reply.
              </p>
            </div>

            <div className="space-y-3">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  data-testid="skill-row"
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex-1 pr-4">
                    <p className="text-sm font-medium text-slate-900">{skill.label}</p>
                    <p className="text-xs text-slate-500">{skill.description}</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={skill.enabled}
                    aria-label={`Toggle ${skill.label}`}
                    data-testid={`skill-toggle-${skill.id}`}
                    onClick={() => handleSkillToggle(skill.id)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                      skill.enabled ? 'bg-slate-900' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                        skill.enabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>

            {skillsError && (
              <p className="text-sm text-red-600" role="alert">
                {skillsError}
              </p>
            )}
            {skillsMessage && (
              <p className="text-sm text-green-600" role="status">
                {skillsMessage}
              </p>
            )}

            <button
              onClick={handleSkillsSave}
              disabled={skillsSaving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {skillsSaving ? 'Saving…' : 'Save skills'}
            </button>
          </div>
        )}

        {/* Account tab */}
        {activeTab === 'account' && (
          <div className="mt-6 space-y-6">

            {/* Duplicate account detection */}
            <div
              data-testid="account-duplicates-section"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <h2 className="text-sm font-semibold text-slate-700">Duplicate Accounts</h2>
              <p className="mt-1 text-xs text-slate-500">
                If you signed in with multiple methods using the same email, we can merge those
                accounts so all your data lives in one place.
              </p>

              {duplicatesLoading && (
                <p data-testid="account-duplicates-loading" className="mt-3 text-xs text-slate-400">
                  Checking for duplicates…
                </p>
              )}

              {!duplicatesLoading && duplicatesError && (
                <p
                  data-testid="account-duplicates-error"
                  role="alert"
                  className="mt-3 text-sm text-red-600"
                >
                  {duplicatesError}
                </p>
              )}

              {!duplicatesLoading && !duplicatesError && duplicates.length === 0 && (
                <p data-testid="account-duplicates-none" className="mt-3 text-xs text-slate-500">
                  No duplicate accounts detected.
                </p>
              )}

              {!duplicatesLoading && !duplicatesError && duplicates.length > 0 && (
                <ul className="mt-3 space-y-2" data-testid="account-duplicates-list">
                  {duplicates.map((dup) => (
                    <li
                      key={dup.id}
                      data-testid={`account-duplicate-row-${dup.id}`}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-800">{dup.email}</p>
                        <p className="text-xs text-slate-400">
                          Created {new Date(dup.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        data-testid={`account-merge-btn-${dup.id}`}
                        onClick={() => setMergeConfirm(dup)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white"
                      >
                        Merge
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {mergeError && (
                <p
                  data-testid="account-merge-error"
                  role="alert"
                  className="mt-3 text-sm text-red-600"
                >
                  {mergeError}
                </p>
              )}
              {mergeSuccess && (
                <p
                  data-testid="account-merge-success"
                  role="status"
                  className="mt-3 text-sm text-green-600"
                >
                  {mergeSuccess}
                </p>
              )}
            </div>

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

        {/* Merge confirmation dialog (AINBOX-50) */}
        {mergeConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            role="dialog"
            aria-label="confirm merge account"
            data-testid="account-merge-dialog"
          >
            <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-900">Merge account?</h3>
              <p className="mt-2 text-sm text-slate-500">
                All emails, drafts, and knowledge base items from{' '}
                <span className="font-medium text-slate-700">{mergeConfirm.email}</span> will be
                moved into your current account. The duplicate account profile will be removed.
                This cannot be undone.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  data-testid="account-merge-cancel"
                  onClick={() => setMergeConfirm(null)}
                  disabled={mergeLoading}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  data-testid="account-merge-confirm"
                  onClick={() => handleMerge(mergeConfirm)}
                  disabled={mergeLoading}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {mergeLoading ? 'Merging…' : 'Merge account'}
                </button>
              </div>
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
      </main>
    </>
  );
}
