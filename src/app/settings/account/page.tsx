'use client';

import { useState } from 'react';
import AppLayout from '@/components/AppLayout';

export default function SettingsAccountPage() {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDeleteAccount = async () => {
    try {
      await fetch('/api/account/delete', { method: 'DELETE' });
    } catch {
      // offline mock
    }
    setDeleteDialogOpen(false);
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">Account</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your account settings</p>

        <div className="mt-6 space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Plan</h2>
            <p className="mt-1 text-sm text-slate-500">Starter plan</p>
            <a
              href="/pricing"
              className="mt-2 inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Upgrade
            </a>
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
    </AppLayout>
  );
}
