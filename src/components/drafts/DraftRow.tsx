'use client';

import { useState } from 'react';

export type Draft = {
  id: string;
  subject: string | null;
  category: string | null;
  confidence: number;
  is_reply?: boolean;
  body?: string | null;
  created_at?: string | null;
};

type Props = {
  draft: Draft;
  selected?: boolean;
  onApprove: (id: string) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
};

function confidenceTier(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.85) return 'high';
  if (c >= 0.6) return 'medium';
  return 'low';
}

const tierClass: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-green-100 text-green-800 border-green-300',
  medium: 'bg-amber-100 text-amber-800 border-amber-300',
  low: 'bg-red-100 text-red-800 border-red-300',
};

export function DraftRow({ draft, selected, onApprove, onReject }: Props) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body ?? '');
  const tier = confidenceTier(draft.confidence);
  const subject = draft.subject || (draft.is_reply ? 'Re: (no subject)' : '(no subject)');
  const pct = Math.round(draft.confidence * 100);

  return (
    <li
      data-testid="draft-card"
      data-draft-id={draft.id}
      data-focused={selected ? 'true' : 'false'}
      aria-selected={selected ? 'true' : 'false'}
      className={`w-full rounded-lg border bg-white p-3 shadow-sm transition ${
        selected ? 'border-brand-500 ring-2 ring-brand-500 selected' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900 sm:text-base">{subject}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {draft.category ?? 'other'}
            </span>
            <span
              data-testid="confidence-score"
              aria-label={`confidence ${pct}%`}
              className={`confidence-score rounded-full border px-2 py-0.5 text-xs font-medium ${tierClass[tier]}`}
            >
              {pct}%
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onApprove(draft.id)}
            className="inline-flex items-center justify-center rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onReject(draft.id)}
            className="inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-1"
          >
            Reject
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-3">
          <textarea
            data-testid="draft-editor"
            className="block w-full rounded-md border border-slate-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
          />
        </div>
      )}
    </li>
  );
}
