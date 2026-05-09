'use client';

/**
 * /onboarding/kb-review
 * AINBOX-8 — Surface extracted KB items grouped by type, with
 * Approve / Edit / Discard buttons. Approve sets human_verified=true.
 * PRD: §7.6 §7.7
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KB_ITEM_TYPES, type KbItemType } from '@/lib/kb/extract';

interface KbItemRow {
  id: string;
  type: KbItemType;
  content: string;
  confidence: number;
  source_email_id: string | null;
  human_verified: boolean;
}

interface ListResp {
  ok: boolean;
  items: KbItemRow[];
  grouped: Record<KbItemType, KbItemRow[]>;
}

const TYPE_LABEL: Record<KbItemType, string> = {
  faq: 'FAQs',
  policy: 'Policies',
  pricing: 'Pricing',
  preference: 'Preferences',
  contact: 'Contacts',
  signature: 'Signatures',
  'tone-sample': 'Tone samples',
};

export default function Page() {
  const [items, setItems] = useState<KbItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [finished, setFinished] = useState(false);

  const grouped = useMemo(() => {
    const out: Record<KbItemType, KbItemRow[]> = {
      faq: [],
      policy: [],
      pricing: [],
      preference: [],
      contact: [],
      signature: [],
      'tone-sample': [],
    };
    for (const it of items) if (KB_ITEM_TYPES.includes(it.type)) out[it.type].push(it);
    for (const t of KB_ITEM_TYPES) out[t].sort((a, b) => b.confidence - a.confidence);
    return out;
  }, [items]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/kb/items', { credentials: 'include' });
      if (!r.ok) throw new Error(`list ${r.status}`);
      const data = (await r.json()) as ListResp;
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runExtract() {
    setExtracting(true);
    setError(null);
    try {
      const r = await fetch('/api/kb/extract', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 200 }),
      });
      if (!r.ok) throw new Error(`extract ${r.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'extract failed');
    } finally {
      setExtracting(false);
    }
  }

  async function approve(id: string, content?: string) {
    const r = await fetch(`/api/kb/items/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ human_verified: true, ...(content ? { content } : {}) }),
    });
    if (r.ok) {
      const { item } = (await r.json()) as { item: KbItemRow };
      setItems((xs) => xs.map((x) => (x.id === id ? item : x)));
      setEditingId(null);
    }
  }

  async function discard(id: string) {
    const r = await fetch(`/api/kb/items/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (r.ok) setItems((xs) => xs.filter((x) => x.id !== id));
  }

  function startEdit(it: KbItemRow) {
    setEditingId(it.id);
    setEditDraft(it.content);
  }

  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-2xl font-bold">Knowledge base review</h1>
      <p className="mt-2 text-sm text-gray-600">
        Confirm what we learned from your inbox. Items you approve will be used to draft replies in your voice.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="kb-toolbar">
        <button
          onClick={runExtract}
          disabled={extracting}
          className="rounded bg-black text-white px-3 py-1.5 text-sm disabled:opacity-50"
          data-testid="kb-extract-button"
        >
          {extracting ? 'Extracting…' : 'Run extraction'}
        </button>
        <button
          onClick={() => void load()}
          className="rounded border px-3 py-1.5 text-sm"
          data-testid="kb-refresh-button"
        >
          Refresh
        </button>
        <button
          onClick={() => setFinished(true)}
          className="ml-auto rounded bg-emerald-600 text-white px-4 py-1.5 text-sm"
          data-testid="kb-finish-button"
        >
          Finish
        </button>
      </div>

      {finished && (
        <div role="alert" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="kb-finish-success">
          Setup complete! <a href="/inbox" className="underline font-medium">Go to inbox →</a>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600" data-testid="kb-error">
          {error}
        </p>
      )}
      {loading && <p className="mt-4 text-sm" data-testid="kb-loading">Loading…</p>}

      {!loading && items.length === 0 && (
        <p className="mt-8 text-sm text-gray-500" data-testid="kb-empty">
          No KB items yet. Run extraction over your synced emails.
        </p>
      )}

      <div className="mt-8 space-y-10">
        {KB_ITEM_TYPES.map((t) => {
          const rows = grouped[t];
          if (!rows.length) return null;
          return (
            <section key={t} data-testid={`kb-group-${t}`}>
              <h2 className="text-lg font-semibold">
                {TYPE_LABEL[t]}{' '}
                <span className="text-sm font-normal text-gray-500">({rows.length})</span>
              </h2>
              <ul className="mt-3 divide-y rounded border">
                {rows.map((it) => {
                  const isEditing = editingId === it.id;
                  return (
                    <li
                      key={it.id}
                      className="p-4 flex flex-col gap-2"
                      data-testid={`kb-item-${it.id}`}
                      data-kb-type={it.type}
                    >
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            rows={3}
                            className="w-full border rounded p-2 text-sm"
                            data-testid={`kb-edit-input-${it.id}`}
                          />
                        ) : (
                          <p className="text-sm break-words">{it.content}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                          confidence {(it.confidence * 100).toFixed(0)}%
                          {it.human_verified ? ' · verified' : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => approve(it.id, editDraft)}
                              className="rounded bg-emerald-600 text-white px-3 py-1 text-xs"
                              data-testid={`kb-save-${it.id}`}
                            >
                              Save & approve
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded border px-3 py-1 text-xs"
                              data-testid={`kb-cancel-${it.id}`}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => approve(it.id)}
                              className="rounded bg-emerald-600 text-white px-3 py-1 text-xs disabled:opacity-50"
                              disabled={it.human_verified}
                              data-testid={`kb-approve-${it.id}`}
                            >
                              {it.human_verified ? 'Approved' : 'Approve'}
                            </button>
                            <button
                              onClick={() => startEdit(it)}
                              className="rounded border px-3 py-1 text-xs"
                              data-testid={`kb-edit-${it.id}`}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => discard(it.id)}
                              className="rounded border border-red-500 text-red-600 px-3 py-1 text-xs"
                              data-testid={`kb-discard-${it.id}`}
                            >
                              Discard
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
