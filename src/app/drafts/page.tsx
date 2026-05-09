'use client';

import { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { MOCK_DRAFTS } from '@/lib/mock-data';
import type { Draft } from '@/lib/mock-data';

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    // Sort by confidence DESC
    const sorted = [...MOCK_DRAFTS].sort((a, b) => b.confidence - a.confidence);
    setDrafts(sorted);
    setLoading(false);
  }, []);

  const handleApprove = async (draftId: string) => {
    try {
      await fetch(`/api/drafts/${draftId}/approve`, { method: 'POST' });
    } catch {
      // offline mock
    }
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const handleReject = async (draftId: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const startEdit = (draft: Draft) => {
    setEditingId(draft.id);
    setEditContent(draft.body);
  };

  const saveEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (drafts.length === 0) return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, drafts.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'a':
          e.preventDefault();
          handleApprove(drafts[selectedIndex].id);
          break;
        case 'r':
          e.preventDefault();
          handleReject(drafts[selectedIndex].id);
          break;
      }
    },
    [drafts, selectedIndex]
  );

  return (
    <AppLayout>
      <div
        className="mx-auto max-w-4xl px-4 py-6 sm:px-6"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <h1 className="text-2xl font-bold text-slate-900">Drafts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review and approve AI-generated draft replies
        </p>

        {/* Loading state */}
        {loading && (
          <div className="mt-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} data-testid="skeleton" className="skeleton-loader h-24 animate-pulse rounded-lg bg-slate-200" />
            ))}
          </div>
        )}

        {/* Draft loading spinner (structural) */}
        <div data-testid="draft-loading" aria-label="generating" className="hidden">
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>

        {/* Empty state */}
        {!loading && drafts.length === 0 && (
          <div className="mt-12 text-center">
            <p className="text-lg font-medium text-slate-700">All clear</p>
            <p className="mt-1 text-sm text-slate-500">No pending drafts to review</p>
          </div>
        )}

        {/* Draft list */}
        {!loading && drafts.length > 0 && (
          <div className="mt-6 space-y-3">
            {drafts.map((draft, idx) => (
              <div
                key={draft.id}
                data-testid="draft-card"
                data-focused={idx === selectedIndex ? 'true' : 'false'}
                aria-selected={idx === selectedIndex ? 'true' : 'false'}
                className={`rounded-lg border bg-white p-4 transition-colors ${
                  idx === selectedIndex
                    ? 'selected border-slate-900 ring-1 ring-slate-900'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900">{draft.subject}</p>
                      <span
                        data-testid="confidence-score"
                        aria-label={`confidence ${Math.round(draft.confidence * 100)} percent`}
                        className="confidence-score shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                      >
                        {Math.round(draft.confidence * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">To: {draft.recipient}</p>
                    <p className="mt-1 text-xs text-slate-400">Category: {draft.category}</p>
                  </div>
                </div>

                {editingId === draft.id ? (
                  <div className="mt-3">
                    <textarea
                      data-testid="draft-editor"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 p-3 text-sm focus:border-slate-400 focus:outline-none"
                      rows={4}
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={saveEdit}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => handleApprove(draft.id)}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => startEdit(draft)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleReject(draft.id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Keyboard shortcut hint */}
        {drafts.length > 0 && (
          <p className="mt-4 text-center text-xs text-slate-400">
            j/k navigate · a approve · r reject
          </p>
        )}
      </div>
    </AppLayout>
  );
}
