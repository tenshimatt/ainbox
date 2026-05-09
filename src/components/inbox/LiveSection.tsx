'use client';

/**
 * LiveSection — wraps a Supabase Realtime subscription for an inbox section.
 *
 * PRD §5.3 / §7.13: live updates on the /inbox dashboard via Supabase Realtime
 * for email_messages, drafts, and audit_log inserts/updates scoped to the user.
 *
 * Server component (page.tsx) does the initial fetch and passes plain JSON
 * `initialRows` plus a `kind` discriminator that selects how each row is
 * rendered. We can't pass a `renderRow` function from a server component to
 * a client component, so the rendering logic lives here.
 *
 * Tenant isolation is enforced by Supabase RLS server-side; this client
 * subscription cannot read other users' rows even if filter were tampered.
 */

import { useEffect, useState, useCallback } from 'react';
import { getBrowserClient } from '@/lib/supabase';

export type InboundRow = {
  id: string;
  from_address: string | null;
  subject: string | null;
  received_at: string | null;
  category: string | null;
};

export type DraftRow = {
  id: string;
  subject: string | null;
  recipient: string | null;
  confidence: number | null;
  category: string | null;
  status: string | null;
  updated_at: string | null;
};

export type LiveKind = 'inbound' | 'pending-draft' | 'sent-draft';

export interface LiveSectionProps {
  title: string;
  kind: LiveKind;
  /** Supabase table to subscribe to (RLS scopes to auth.uid()) */
  table: 'email_messages' | 'drafts' | 'audit_log';
  /** Optional Postgres `filter` string, e.g. `is_outbound=eq.false` */
  filter?: string;
  /** Server-fetched initial rows (latest first) */
  initialRows: Array<InboundRow | DraftRow>;
  /** Test id for the section wrapper */
  testId: string;
  /** Empty-state copy */
  emptyText?: string;
  /** Cap rows in DOM to avoid unbounded growth */
  maxRows?: number;
}

function formatTime(iso: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '';
  }
}

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  return (
    <span
      data-testid="confidence-score"
      className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
      aria-label={`confidence ${pct}%`}
    >
      {pct}%
    </span>
  );
}

function InboundRowView({ row }: { row: InboundRow }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900 truncate">
          {row.subject ?? '(no subject)'}
        </span>
        {row.category && (
          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
            {row.category}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="truncate">{row.from_address ?? 'unknown sender'}</span>
        <span className="shrink-0">{formatTime(row.received_at)}</span>
      </div>
    </div>
  );
}

function PendingDraftRowView({ row }: { row: DraftRow }) {
  return (
    <a
      data-testid="draft-card"
      href={`/drafts?focus=${encodeURIComponent(row.id)}`}
      className="flex flex-col gap-1 no-underline text-inherit"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900 truncate">
          {row.subject ?? '(no subject)'}
        </span>
        <ConfidenceBadge value={row.confidence} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="truncate">{row.recipient ?? 'unknown recipient'}</span>
        {row.category && (
          <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
            {row.category}
          </span>
        )}
      </div>
    </a>
  );
}

function SentDraftRowView({ row }: { row: DraftRow }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900 truncate">
          Sent: {row.subject ?? '(no subject)'}
        </span>
        <ConfidenceBadge value={row.confidence} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="truncate">{row.recipient ?? 'unknown recipient'}</span>
        <span className="shrink-0">{formatTime(row.updated_at)}</span>
      </div>
    </div>
  );
}

function renderByKind(kind: LiveKind, row: InboundRow | DraftRow) {
  if (kind === 'inbound') return <InboundRowView row={row as InboundRow} />;
  if (kind === 'pending-draft') return <PendingDraftRowView row={row as DraftRow} />;
  return <SentDraftRowView row={row as DraftRow} />;
}

export function LiveSection(props: LiveSectionProps) {
  const {
    title,
    kind,
    table,
    filter,
    initialRows,
    testId,
    emptyText = 'Nothing yet.',
    maxRows = 50,
  } = props;

  const [rows, setRows] = useState<Array<InboundRow | DraftRow>>(initialRows);

  const upsertRow = useCallback(
    (row: InboundRow | DraftRow) => {
      setRows((prev) => {
        const without = prev.filter((r) => r.id !== row.id);
        return [row, ...without].slice(0, maxRows);
      });
    },
    [maxRows],
  );

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    try {
      const supabase = getBrowserClient();
      const channelName = `inbox-${table}-${Math.random().toString(36).slice(2, 8)}`;
      const channel = supabase.channel(channelName);

      const config: { event: '*'; schema: 'public'; table: string; filter?: string } = {
        event: '*',
        schema: 'public',
        table,
      };
      if (filter) config.filter = filter;

      // @ts-expect-error supabase-js typing for postgres_changes payload is loose
      channel.on('postgres_changes', config, (payload: { new: InboundRow | DraftRow; eventType: string }) => {
        if (cancelled) return;
        if (payload?.new && (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE')) {
          upsertRow(payload.new);
        }
      });

      channel.subscribe();

      cleanup = () => {
        try {
          supabase.removeChannel(channel);
        } catch {
          /* ignore */
        }
      };
    } catch {
      // No Supabase env in test/SSR fallback — silently skip realtime.
    }

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [table, filter, upsertRow]);

  // Test hook: dispatch a CustomEvent('inbox-realtime-mock', { detail: { table, row } })
  // to simulate a realtime row arrival from Playwright tests without a live socket.
  useEffect(() => {
    function onMock(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { table?: string; row?: InboundRow | DraftRow }
        | undefined;
      if (!detail || detail.table !== table || !detail.row) return;
      upsertRow(detail.row);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('inbox-realtime-mock', onMock as EventListener);
      return () => window.removeEventListener('inbox-realtime-mock', onMock as EventListener);
    }
  }, [table, upsertRow]);

  return (
    <section
      data-testid={testId}
      className="w-full max-w-full overflow-hidden"
      aria-label={title}
    >
      <h2 className="text-base font-semibold mb-2 text-slate-800">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid={`${testId}-empty`}>
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={String(row.id)}
              data-testid={`${testId}-row`}
              className="rounded-md border border-slate-200 bg-white p-3 text-sm w-full max-w-full break-words"
            >
              {renderByKind(kind, row)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default LiveSection;
