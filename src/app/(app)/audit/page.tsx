'use client';

/**
 * /audit — Audit log UI + CSV export
 * TASKRESPONSE-14
 * PRD: §5.3 §7.14 §6.1
 *
 * Client component. Reads /api/audit and renders a paginated, filterable
 * table with a CSV export link. RLS in the API route scopes the query
 * to auth.uid().
 *
 * Mobile-first: the page itself never overflows horizontally at 375px;
 * the inner table scrolls horizontally inside its container.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

type AuditRow = {
  id?: string | number;
  created_at: string;
  action?: string | null;
  email_id?: string | null;
  category?: string | null;
  model?: string | null;
  confidence?: number | null;
  kb_items_used?: unknown;
  details?: unknown;
};

type AuditResponse = {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
};

const EVENT_TYPES = ['', 'classify', 'draft', 'send'] as const;
const CATEGORIES = [
  '',
  'sales',
  'support',
  'invoice',
  'complaint',
  'meeting',
  'investor',
  'spam',
  'urgent',
  'escalation',
  'other',
] as const;

const PAGE_SIZE = 50;

function kbCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    const v = value as { count?: unknown; items?: unknown };
    if (typeof v.count === 'number') return v.count;
    if (Array.isArray(v.items)) return v.items.length;
  }
  return 0;
}

function truncate(value: unknown, n = 80): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'object') {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  } else {
    s = String(value);
  }
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function fmtConfidence(c: number | null | undefined): string {
  if (c === null || c === undefined) return '';
  if (typeof c !== 'number' || !Number.isFinite(c)) return '';
  if (c >= 0 && c <= 1) return (c * 100).toFixed(1) + '%';
  return c.toString();
}

type Filters = {
  from: string;
  to: string;
  event_type: string;
  category: string;
};

const EMPTY_FILTERS: Filters = { from: '', to: '', event_type: '', category: '' };

/**
 * Past 7 days → today, as YYYY-MM-DD strings.
 * Generated client-side so the values are fresh on every mount.
 */
function defaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(weekAgo), to: fmt(today) };
}

function buildQuery(filters: Filters, page: number): string {
  const qs = new URLSearchParams();
  if (filters.from) qs.set('from', filters.from);
  if (filters.to) qs.set('to', filters.to);
  if (filters.event_type) qs.set('event_type', filters.event_type);
  if (filters.category) qs.set('category', filters.category);
  qs.set('page', String(page));
  qs.set('pageSize', String(PAGE_SIZE));
  return qs.toString();
}

export default function AuditPage() {
  // `pending` is what's typed into the form; `applied` is what's been
  // committed by clicking "Apply filters" (and used for fetch + export).
  // Default both pending + applied to last-7-days. Use a lazy initialiser
  // so the dates are computed once on first mount (not re-rendered).
  const initial = useMemo<Filters>(() => ({ ...EMPTY_FILTERS, ...defaultDateRange() }), []);
  const [pending, setPending] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditResponse>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filters: Filters, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/audit?${buildQuery(filters, p)}`, {
        cache: 'no-store',
      });
      if (!resp.ok) {
        setError(`HTTP ${resp.status}`);
        setData({ rows: [], total: 0, page: p, pageSize: PAGE_SIZE });
        return;
      }
      const json = (await resp.json()) as AuditResponse;
      setData(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'fetch_failed';
      setError(msg);
      setData({ rows: [], total: 0, page: p, pageSize: PAGE_SIZE });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied, page);
  }, [load, applied, page]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data.total ?? 0) / PAGE_SIZE)),
    [data.total],
  );

  const exportHref = useMemo(() => {
    const qs = new URLSearchParams();
    if (applied.from) qs.set('from', applied.from);
    if (applied.to) qs.set('to', applied.to);
    if (applied.event_type) qs.set('event_type', applied.event_type);
    if (applied.category) qs.set('category', applied.category);
    const s = qs.toString();
    return `/api/audit/export${s ? `?${s}` : ''}`;
  }, [applied]);

  const onApply = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setApplied(pending);
    setPage(1);
    // Reflect in URL so links/history are shareable.
    if (typeof window !== 'undefined') {
      const qs = buildQuery(pending, 1);
      window.history.replaceState(null, '', `/audit?${qs}`);
    }
  };

  const onReset = () => {
    setPending(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/audit');
    }
  };

  const setField = <K extends keyof Filters>(key: K, value: string) => {
    setPending((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <main className="container mx-auto px-4 py-6 max-w-full">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-gray-600">
          Every classify, draft, and send decision (24-month retention).
        </p>
      </header>

      <form
        onSubmit={onApply}
        className="mb-4 flex flex-wrap items-end gap-2"
        data-testid="audit-filters"
      >
        <label className="flex flex-col text-xs text-gray-700">
          <span>From</span>
          <input
            type="date"
            name="from"
            value={pending.from}
            onChange={(e) => setField('from', e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            data-testid="filter-from"
          />
        </label>
        <label className="flex flex-col text-xs text-gray-700">
          <span>To</span>
          <input
            type="date"
            name="to"
            value={pending.to}
            onChange={(e) => setField('to', e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            data-testid="filter-to"
          />
        </label>
        <label className="flex flex-col text-xs text-gray-700">
          <span>Event type</span>
          <select
            name="event_type"
            value={pending.event_type}
            onChange={(e) => setField('event_type', e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            data-testid="filter-event-type"
          >
            {EVENT_TYPES.map((e) => (
              <option key={e || 'all'} value={e}>
                {e || 'All'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-700">
          <span>Category</span>
          <select
            name="category"
            value={pending.category}
            onChange={(e) => setField('category', e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            data-testid="filter-category"
          >
            {CATEGORIES.map((c) => (
              <option key={c || 'all'} value={c}>
                {c || 'All'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded bg-black px-3 py-1 text-sm font-medium text-white hover:bg-gray-800"
          data-testid="filter-apply"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          data-testid="filter-reset"
        >
          Reset
        </button>
        <a
          href={exportHref}
          download
          className="ml-auto rounded border border-gray-800 bg-white px-3 py-1 text-sm font-medium text-gray-900 hover:bg-gray-50"
          data-testid="export-csv"
          role="button"
        >
          Export CSV
        </a>
      </form>

      {error ? (
        <div
          role="alert"
          className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          data-testid="audit-error"
        >
          Could not load audit log: {error}
        </div>
      ) : null}

      <div
        className="w-full overflow-x-auto rounded border border-gray-200"
        data-testid="audit-table-scroll"
      >
        <table
          className="min-w-[720px] w-full text-left text-sm"
          data-testid="audit-log"
          aria-label="Audit log"
        >
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th scope="col" className="px-3 py-2">Timestamp</th>
              <th scope="col" className="px-3 py-2">Event</th>
              <th scope="col" className="px-3 py-2">Target</th>
              <th scope="col" className="px-3 py-2">Category</th>
              <th scope="col" className="px-3 py-2">Model</th>
              <th scope="col" className="px-3 py-2">Confidence</th>
              <th scope="col" className="px-3 py-2">KB items</th>
              <th scope="col" className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && data.rows.length === 0 ? (
              <tr data-testid="audit-loading">
                <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : data.rows.length === 0 ? (
              <tr data-testid="audit-empty">
                <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                  No audit entries match the current filters.
                </td>
              </tr>
            ) : (
              data.rows.map((r, i) => {
                const evt = (r.action ?? '').toString().toLowerCase();
                return (
                  <tr
                    key={(r.id ?? `${r.created_at}-${i}`).toString()}
                    data-testid="audit-row"
                    className="border-t border-gray-100"
                  >
                    <td
                      className="px-3 py-2 whitespace-nowrap"
                      data-testid="audit-timestamp"
                    >
                      <time dateTime={r.created_at}>{r.created_at}</time>
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap decision-type"
                      data-testid="decision-type"
                    >
                      {evt}
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap font-mono text-xs"
                      data-testid="target-id"
                    >
                      {r.email_id ?? ''}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.category ?? ''}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.model ?? ''}</td>
                    <td
                      className="px-3 py-2 whitespace-nowrap confidence"
                      data-testid="confidence"
                      aria-label="confidence"
                    >
                      {fmtConfidence(r.confidence ?? null)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" data-testid="kb-count">
                      {kbCount(r.kb_items_used)}
                    </td>
                    <td
                      className="px-3 py-2 max-w-[18rem] truncate"
                      title={String(r.details ?? '')}
                    >
                      {truncate(r.details, 80)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <nav
        className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm"
        aria-label="Audit log pagination"
      >
        <span className="text-gray-600" data-testid="audit-summary">
          {data.total === 0
            ? 'No entries'
            : `Showing page ${page} of ${totalPages} · ${data.total.toLocaleString()} total`}
        </span>
        <span className="flex gap-2">
          {page > 1 ? (
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
              data-testid="page-prev"
            >
              Previous
            </button>
          ) : null}
          {page < totalPages ? (
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
              data-testid="page-next"
            >
              Next
            </button>
          ) : null}
        </span>
      </nav>
    </main>
  );
}
