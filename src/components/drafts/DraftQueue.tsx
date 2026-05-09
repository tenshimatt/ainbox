'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DraftRow, type Draft } from './DraftRow';

type Props = {
  initial: Draft[];
};

function sortDrafts(list: Draft[]): Draft[] {
  return [...list].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
}

export function DraftQueue({ initial }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(() => sortDrafts(initial));
  const [selectedIdx, setSelectedIdx] = useState<number>(initial.length > 0 ? 0 : -1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the queue from the AINBOX-10 endpoint on mount. Falls back silently
  // if the endpoint isn't deployed yet — keeps /drafts renderable in dev.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/drafts', { cache: 'no-store' });
        if (!resp.ok) return;
        const data = (await resp.json()) as { drafts?: Draft[] } | Draft[];
        const list = Array.isArray(data) ? data : data.drafts ?? [];
        if (cancelled) return;
        const sorted = sortDrafts(
          list.map((d) => ({
            id: String(d.id),
            subject: d.subject ?? null,
            category: d.category ?? null,
            confidence: typeof d.confidence === 'number' ? d.confidence : 0,
            is_reply: Boolean(d.is_reply),
            body: d.body ?? null,
            created_at: d.created_at ?? null,
          })),
        );
        setDrafts(sorted);
        setSelectedIdx(sorted.length > 0 ? 0 : -1);
      } catch {
        // best-effort; UI shows empty state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const removeLocal = useCallback((id: string) => {
    setDrafts((cur) => {
      const next = cur.filter((d) => d.id !== id);
      setSelectedIdx((idx) => {
        if (next.length === 0) return -1;
        return Math.min(idx, next.length - 1);
      });
      return next;
    });
  }, []);

  const handleApprove = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`/api/drafts/${id}/approve`, { method: 'POST' });
        if (!resp.ok) throw new Error(`Approve failed: ${resp.status}`);
        removeLocal(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Approve failed');
      } finally {
        setLoading(false);
      }
    },
    [removeLocal],
  );

  const handleReject = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`/api/drafts/${id}/reject`, { method: 'POST' });
        if (!resp.ok) throw new Error(`Reject failed: ${resp.status}`);
        removeLocal(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Reject failed');
      } finally {
        setLoading(false);
      }
    },
    [removeLocal],
  );

  // Realtime subscription (best-effort; no-op if Supabase env missing)
  useEffect(() => {
    let cancelled = false;
    let channel: { unsubscribe: () => void } | null = null;
    (async () => {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) return;
        const { getBrowserClient } = await import('@/lib/supabase');
        const client = getBrowserClient();
        const sub = (client.channel('drafts-queue') as unknown as {
          on: (
            type: string,
            filter: Record<string, unknown>,
            cb: (payload: { eventType: string; new: Draft; old: Draft }) => void,
          ) => { subscribe: () => { unsubscribe: () => void } };
        })
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'drafts' },
            (payload: { eventType: string; new: Draft; old: Draft }) => {
              if (cancelled) return;
              if (payload.eventType === 'INSERT' && payload.new) {
                setDrafts((cur) => sortDrafts([payload.new, ...cur.filter((d) => d.id !== payload.new.id)]));
              } else if (payload.eventType === 'UPDATE' && payload.new) {
                setDrafts((cur) => sortDrafts(cur.map((d) => (d.id === payload.new.id ? { ...d, ...payload.new } : d))));
              } else if (payload.eventType === 'DELETE' && payload.old) {
                setDrafts((cur) => cur.filter((d) => d.id !== payload.old.id));
              }
            },
          )
          .subscribe();
        channel = { unsubscribe: () => sub.unsubscribe() };
      } catch {
        // realtime is best-effort
      }
    })();
    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  // Keyboard shortcuts: j (next), k (prev), a (approve), r (reject)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (drafts.length === 0) return;
      const key = e.key.toLowerCase();
      if (key === 'j') {
        e.preventDefault();
        setSelectedIdx((i) => {
          const start = i < 0 ? -1 : i;
          return Math.min(drafts.length - 1, start + 1);
        });
      } else if (key === 'k') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (key === 'a') {
        e.preventDefault();
        setSelectedIdx((i) => {
          const idx = i < 0 ? 0 : i;
          const d = drafts[idx];
          if (d) void handleApprove(d.id);
          return idx;
        });
      } else if (key === 'r') {
        e.preventDefault();
        setSelectedIdx((i) => {
          const idx = i < 0 ? 0 : i;
          const d = drafts[idx];
          if (d) void handleReject(d.id);
          return idx;
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drafts, handleApprove, handleReject]);

  const items = useMemo(() => drafts, [drafts]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-600">No drafts pending. All clear.</p>
        {/* Keep loading-state pattern available in DOM for tests / future generation flows */}
        <div data-testid="draft-loading" className="hidden animate-spin" aria-label="generating draft" />
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div data-testid="draft-loading" aria-label="generating draft" className={`mb-2 h-1 ${loading ? 'animate-pulse bg-slate-200' : 'hidden'}`} />
      <ul className="flex flex-col gap-3">
        {items.map((d, idx) => (
          <DraftRow
            key={d.id}
            draft={d}
            selected={idx === selectedIdx}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))}
      </ul>
    </div>
  );
}
