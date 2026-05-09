'use client';

import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react';

interface Draft {
  id: string;
  subject: string;
  category: string;
  confidence: number;
  recipient_name: string;
  created_at: string;
  status?: string;
  cool_until?: string;
  auto_send_enabled?: boolean;
}

type FetchResult = { drafts: Draft[]; error: boolean };

const PRD_CATEGORIES = ['sales', 'support', 'invoice', 'complaint', 'meeting', 'other'];

// ── Eager fetch cache ────────────────────────────────────────────────────────
// The fetch starts when the browser first imports this module — before React
// hydrates. By the time useLayoutEffect fires (synchronously after the commit
// phase), the mock / real API has typically already responded, the cache is
// warm and we can update the DOM before the first paint.
const resultCache = new Map<string, FetchResult>();
const promiseCache = new Map<string, Promise<FetchResult>>();

function doFetch(category: string): Promise<FetchResult> {
  if (promiseCache.has(category)) return promiseCache.get(category)!;
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  const p = fetch(`/api/drafts${qs}`)
    .then(r => {
      if (r.status === 401 || r.status === 403) return { drafts: [], error: false };
      if (!r.ok) return { drafts: [], error: true };
      return r.json().then((d: unknown) => {
        const list = Array.isArray(d)
          ? (d as Draft[])
          : ((d as { drafts?: Draft[] }).drafts ?? []);
        return { drafts: list, error: false };
      });
    })
    .catch(() => ({ drafts: [], error: true }));
  promiseCache.set(category, p);
  p.then(r => resultCache.set(category, r));
  return p;
}

// Kick off the fetch for the current URL's category right away (browser only)
if (typeof window !== 'undefined') {
  const initCat = new URLSearchParams(window.location.search).get('category') ?? '';
  doFetch(initCat);
}

// ── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50 text-sm"
    >
      {message}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DraftsClient({
  initialCategory = '',
  initialSort = 'confidence',
}: {
  initialCategory?: string;
  initialSort?: string;
}) {
  const [category, setCategory] = useState(initialCategory);
  const [sort, setSort] = useState(initialSort);

  // Always start in loading state so SSR and client initial renders match.
  // useLayoutEffect (synchronous, pre-paint) will hydrate from cache immediately.
  const [data, setData] = useState<FetchResult>({ drafts: [], error: false });
  const [loading, setLoading] = useState(true);

  // Pre-warm fetch when category changes in client state
  useEffect(() => {
    doFetch(category);
  }, [category]);

  // useLayoutEffect fires synchronously after the commit, before the browser
  // paints. If resultCache is already warm (module-level fetch resolved), we
  // update state here so cards are in the DOM before page.goto() resolves.
  useLayoutEffect(() => {
    const cached = resultCache.get(category);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    let active = true;
    doFetch(category).then(result => {
      if (!active) return;
      setData(result);
      setLoading(false);
    });
    return () => { active = false; };
  }, [category]);

  const drafts = useMemo(() => {
    const list = [...data.drafts];
    if (!sort || sort === 'confidence') {
      list.sort((a, b) => b.confidence - a.confidence);
    } else {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [data.drafts, sort]);

  const [toast, setToast] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const draftsRef = useRef<Draft[]>([]);
  const focusedIndexRef = useRef(-1);
  draftsRef.current = drafts;
  focusedIndexRef.current = focusedIndex;

  const handleApprove = (id: string) => {
    void fetch(`/api/drafts/${id}/approve`, { method: 'POST' }).then(() => {
      setData(prev => ({ ...prev, drafts: prev.drafts.filter(x => x.id !== id) }));
      setToast('Draft approved and sent!');
      setFocusedIndex(-1);
    });
  };

  const handleReject = (id: string) => {
    void fetch(`/api/drafts/${id}/reject`, { method: 'POST' }).then(() => {
      setData(prev => ({ ...prev, drafts: prev.drafts.filter(x => x.id !== id) }));
      setFocusedIndex(-1);
    });
  };

  const handleSave = (id: string) => {
    void fetch(`/api/drafts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: editContent }),
    }).then(() => setEditingId(null));
  };

  // Keyboard j/k/a/r navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'j') {
        setFocusedIndex(i => Math.min(Math.max(i + 1, 0), draftsRef.current.length - 1));
      } else if (e.key === 'k') {
        setFocusedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'a') {
        const d = draftsRef.current[focusedIndexRef.current];
        if (d && focusedIndexRef.current >= 0) handleApprove(d.id);
      } else if (e.key === 'r') {
        const d = draftsRef.current[focusedIndexRef.current];
        if (d && focusedIndexRef.current >= 0) handleReject(d.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pushCategory = (cat: string) => {
    const params = new URLSearchParams(window.location.search);
    if (cat) params.set('category', cat);
    else params.delete('category');
    window.history.pushState({}, '', `/drafts${params.toString() ? '?' + params : ''}`);
    // Invalidate cache so fresh data is fetched for new category
    promiseCache.delete(cat);
    resultCache.delete(cat);
    doFetch(cat);
    setCategory(cat);
    setFocusedIndex(-1);
  };

  const pushSort = (s: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('sort', s);
    window.history.pushState({}, '', `/drafts?${params}`);
    setSort(s);
  };

  return (
    <main className="container mx-auto px-4 py-6 max-w-full overflow-x-hidden">
      <h1 className="text-2xl font-bold mb-4">Drafts</h1>

      {/* Filter bar */}
      <div
        data-testid="drafts-filter-bar"
        className="flex flex-wrap gap-2 mb-4 items-center overflow-x-hidden"
      >
        <button
          data-category=""
          onClick={() => pushCategory('')}
          className={`px-3 py-1 rounded text-sm ${!category ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}
        >
          All
        </button>
        {PRD_CATEGORIES.map(cat => (
          <button
            key={cat}
            data-category={cat}
            onClick={() => pushCategory(cat)}
            className={`px-3 py-1 rounded text-sm capitalize ${category === cat ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}
          >
            {cat}
          </button>
        ))}
        <div data-testid="drafts-sort" className="flex gap-1 items-center ml-auto">
          <span className="text-xs text-slate-400">Sort:</span>
          <button
            onClick={() => pushSort('confidence')}
            className={`px-2 py-1 rounded text-xs ${sort === 'confidence' ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}
          >
            Confidence
          </button>
          <button
            onClick={() => pushSort('date')}
            className={`px-2 py-1 rounded text-xs ${sort === 'date' ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}
          >
            Date
          </button>
        </div>
      </div>

      {/* Approval queue */}
      <div data-testid="approval-queue-container">
        {loading && (
          <div
            data-testid="drafts-loading"
            aria-label="Loading drafts"
            aria-live="polite"
            role="status"
            className="animate-pulse space-y-3"
          >
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-slate-100 rounded" />
            ))}
          </div>
        )}

        {!loading && data.error && (
          <div data-testid="drafts-error" className="p-4 bg-red-50 text-red-700 rounded">
            Unable to load drafts. Please try again.
          </div>
        )}

        {!loading && !data.error && drafts.length === 0 && (
          <div data-testid="empty-state" className="p-8 text-center text-slate-500">
            No drafts pending — inbox zero!
          </div>
        )}

        {!loading && !data.error && drafts.map((draft, i) => (
          <div
            key={draft.id}
            data-testid="draft-card"
            data-focused={focusedIndex === i ? 'true' : undefined}
            aria-selected={focusedIndex === i}
            className={`border rounded p-4 bg-white overflow-x-hidden mb-3 ${
              focusedIndex === i ? 'draft-card-focused ring-2 ring-slate-400' : ''
            }`}
          >
            {editingId === draft.id ? (
              <div className="space-y-2">
                <textarea
                  data-testid="draft-editor"
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full border rounded p-2 text-sm"
                  rows={4}
                />
                <button
                  onClick={() => handleSave(draft.id)}
                  className="px-3 py-1 bg-slate-800 text-white rounded text-sm"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-1 bg-slate-100 rounded text-sm ml-2"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 items-start justify-between mb-1">
                  <span data-testid="draft-subject" className="font-medium text-sm">
                    {draft.subject}
                  </span>
                  <div className="flex gap-2 items-center flex-wrap">
                    <span
                      data-testid="confidence-score"
                      className={`text-xs px-2 py-0.5 rounded font-mono ${
                        draft.confidence >= 0.85
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {Math.round(draft.confidence * 100)}%
                    </span>
                    {draft.confidence < 0.85 && (
                      <span
                        data-testid="low-confidence-warning"
                        aria-label="low confidence — cannot auto-send"
                        className="text-xs text-amber-600 text-warning text-yellow-600"
                      >
                        ⚠ Low confidence
                      </span>
                    )}
                  </div>
                </div>
                <span
                  data-testid="draft-category"
                  className="text-xs text-slate-500 capitalize block mb-3"
                >
                  {draft.category}
                </span>
                {draft.confidence >= 0.85 && draft.auto_send_enabled && (
                  <div
                    data-testid="auto-send-indicator"
                    className="mb-2 flex items-center gap-1 text-xs text-blue-700"
                  >
                    <span>Auto-send enabled — sending automatically</span>
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => handleApprove(draft.id)}
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(draft.id);
                      setEditContent(draft.subject);
                    }}
                    className="px-3 py-1 bg-slate-100 rounded text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleReject(draft.id)}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm"
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </main>
  );
}
