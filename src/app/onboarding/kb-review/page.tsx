'use client';

/**
 * /onboarding/kb-review
 * TASKRESPONSE-8 — Surface extracted KB items grouped by type, with
 * Approve / Edit / Discard buttons. Approve sets human_verified=true.
 * TASKRESPONSE-54 — Friendly errors, bulk approve, branching empty states.
 * PRD: §7.6 §7.7
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KB_ITEM_TYPES, type KbItemType } from '@/lib/kb/extract';
import { OnboardingStepper } from '@/components/onboarding/OnboardingStepper';

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

function friendlyError(err: unknown, ctx: 'load' | 'extract' | 'approve' | 'discard'): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (ctx === 'load') {
    if (/40[13]/.test(msg)) return 'Session expired — please sign in again.';
    if (/5\d\d/.test(msg)) return "We couldn't load your knowledge base right now. Try refreshing the page.";
    return 'Failed to load knowledge items. Please refresh.';
  }
  if (ctx === 'extract') {
    if (/40[13]/.test(msg)) return 'Session expired — please sign in again.';
    if (/5\d\d/.test(msg)) return 'Extraction hit an error on our end. Wait a moment and try again.';
    return 'Extraction failed. Please try again.';
  }
  if (ctx === 'approve') return "Couldn't save that approval — please try again.";
  return "Couldn't discard that item — please try again.";
}

export default function Page() {
  const [items, setItems] = useState<KbItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // Track whether at least one extraction attempt has completed (for branching empty state).
  const [extracted, setExtracted] = useState(false);

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

  const unverifiedCount = useMemo(() => items.filter((it) => !it.human_verified).length, [items]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/kb/items', { credentials: 'include' });
      if (!r.ok) throw new Error(`list ${r.status}`);
      const data = (await r.json()) as ListResp;
      setItems(data.items ?? []);
    } catch (err) {
      setError(friendlyError(err, 'load'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-trigger extraction on first mount if no items exist yet.
  // pg_cron also runs every 5 min; this is the immediate kick so the
  // page never sits empty while waiting for the next tick.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
      try {
        const r = await fetch('/api/kb/items', { credentials: 'include' });
        const data = (await r.json()) as ListResp;
        if ((data.items ?? []).length === 0 && !cancelled) {
          setExtracting(true);
          await fetch('/api/kb/extract', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!cancelled) {
            setExtracting(false);
            await load();
            // Mark extraction done AFTER reload so kb-empty stays visible
            // until the new items (or empty result) are in place.
            if (!cancelled) setExtracted(true);
          }
        }
      } catch {
        /* swallow — manual button still available */
        if (!cancelled) setExtracting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
      setExtracted(true);
      await load();
    } catch (err) {
      setError(friendlyError(err, 'extract'));
    } finally {
      setExtracting(false);
    }
  }

  async function approve(id: string, content?: string) {
    try {
      const r = await fetch(`/api/kb/items/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ human_verified: true, ...(content ? { content } : {}) }),
      });
      if (!r.ok) throw new Error(`patch ${r.status}`);
      const { item } = (await r.json()) as { item: KbItemRow };
      setItems((xs) => xs.map((x) => (x.id === id ? item : x)));
      setEditingId(null);
    } catch (err) {
      setError(friendlyError(err, 'approve'));
    }
  }

  async function bulkApprove() {
    const targets = items.filter((it) => !it.human_verified);
    if (!targets.length) return;
    setBulkApproving(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        targets.map((it) =>
          fetch(`/api/kb/items/${it.id}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ human_verified: true }),
          }).then(async (r) => {
            if (!r.ok) throw new Error(`patch ${r.status}`);
            return (await r.json()) as { item: KbItemRow };
          })
        )
      );
      const approved: KbItemRow[] = [];
      let failCount = 0;
      for (const res of results) {
        if (res.status === 'fulfilled') approved.push(res.value.item);
        else failCount++;
      }
      if (approved.length) {
        const approvedMap = new Map(approved.map((a) => [a.id, a]));
        setItems((xs) => xs.map((x) => approvedMap.get(x.id) ?? x));
      }
      if (failCount > 0) {
        setError(`${failCount} item${failCount > 1 ? 's' : ''} couldn't be approved — the rest went through.`);
      }
    } catch (err) {
      setError(friendlyError(err, 'approve'));
    } finally {
      setBulkApproving(false);
    }
  }

  async function discard(id: string) {
    try {
      const r = await fetch(`/api/kb/items/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`delete ${r.status}`);
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch (err) {
      setError(friendlyError(err, 'discard'));
    }
  }

  function startEdit(it: KbItemRow) {
    setEditingId(it.id);
    setEditDraft(it.content);
  }

  const showEmpty = !loading && items.length === 0;

  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <OnboardingStepper currentStep={2} />
      <h1 className="text-2xl font-bold">Knowledge base review</h1>
      <p className="mt-2 text-sm text-gray-600">
        Confirm what we learned from your inbox. Items you approve will be used to draft replies in your voice.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="kb-toolbar">
        <button
          onClick={runExtract}
          disabled={extracting || loading}
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
        {unverifiedCount > 0 && (
          <button
            onClick={() => void bulkApprove()}
            disabled={bulkApproving}
            className="rounded bg-emerald-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
            data-testid="kb-bulk-approve"
          >
            {bulkApproving ? 'Approving…' : `Approve all (${unverifiedCount})`}
          </button>
        )}
        <a href="/inbox" className="ml-auto text-sm underline">
          Done — go to inbox
        </a>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
          data-testid="kb-error"
        >
          {error}
        </div>
      )}
      {loading && <p className="mt-4 text-sm" data-testid="kb-loading">Loading…</p>}

      {/* Pre-extract state: shown before extraction completes (including while extracting) */}
      {showEmpty && !extracted && (
        <p className="mt-8 text-sm text-gray-500" data-testid="kb-empty">
          No items yet. Run extraction over your synced emails.
        </p>
      )}

      {/* Progress indicator shown on top of the empty state during active extraction */}
      {showEmpty && extracting && !extracted && (
        <div className="mt-3 text-center" data-testid="kb-empty-extracting">
          <p className="text-xs text-gray-400">Analyzing your emails — this may take a moment…</p>
          <div className="mt-2 mx-auto h-1.5 w-40 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-2/3 animate-pulse bg-slate-400" />
          </div>
        </div>
      )}

      {/* Post-extract state: extraction ran but found nothing */}
      {showEmpty && !extracting && extracted && (
        <div className="mt-8 text-center" data-testid="kb-empty-done">
          <p className="text-sm text-gray-500">
            We couldn&apos;t find any FAQ, policy, or preference patterns in your emails yet.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Try syncing more email, then run extraction again.
          </p>
        </div>
      )}

      <div className="mt-8 space-y-10">
        {KB_ITEM_TYPES.map((t) => {
          const rows = grouped[t];
          if (!rows.length) return null;
          const sectionUnverified = rows.filter((r) => !r.human_verified);
          return (
            <section key={t} data-testid={`kb-group-${t}`}>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold">
                  {TYPE_LABEL[t]}{' '}
                  <span className="text-sm font-normal text-gray-500">({rows.length})</span>
                </h2>
                {sectionUnverified.length > 1 && (
                  <button
                    onClick={() => void Promise.all(sectionUnverified.map((r) => approve(r.id)))}
                    className="rounded border border-emerald-500 text-emerald-700 px-2 py-0.5 text-xs"
                    data-testid={`kb-bulk-approve-${t}`}
                  >
                    Approve all {TYPE_LABEL[t].toLowerCase()}
                  </button>
                )}
              </div>
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
