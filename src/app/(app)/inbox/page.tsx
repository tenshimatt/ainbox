/**
 * /inbox — live triage dashboard
 *
 * PRD §5.3 App pages — `/inbox` (live triage view + draft queue)
 * PRD §7.13 Dashboard / inbox view — latest 50 inbound + pending drafts
 *           + auto-send activity. Live updates via Supabase Realtime.
 *
 * Server component: fetches initial rows from Supabase (RLS-scoped to
 * auth.uid()). Hydrates three <LiveSection /> client components which
 * subscribe to realtime updates. Mobile-first: 375px no overflow.
 *
 * Tenant isolation: queries go through the SSR Supabase client which runs
 * as the authenticated user. No service-role usage. Email *body* content
 * is never rendered here — only metadata (sender, subject, timestamps,
 * category, confidence) per CLAUDE.md PII boundary.
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import LiveSection, {
  type InboundRow,
  type DraftRow,
} from '@/components/inbox/LiveSection';

export const dynamic = 'force-dynamic';

async function getServerSupabase() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(_name: string, _value: string, _options: CookieOptions) {
        // No-op: Server Components cannot write cookies. Auth refresh
        // happens in middleware/route handlers, not here.
      },
      remove(_name: string, _options: CookieOptions) {
        // No-op: see above.
      },
    },
  });
}

async function fetchInbox() {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return {
      inbound: [] as InboundRow[],
      pendingDrafts: [] as DraftRow[],
      recentActivity: [] as DraftRow[],
    };
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [inboundRes, draftsRes, activityRes] = await Promise.all([
    supabase
      .from('email_messages')
      .select('id, from_addr, subject, subject_hash, received_at, internal_date, category, label_ids')
      .eq('is_outbound', false)
      .order('received_at', { ascending: false, nullsFirst: false })
      .limit(50),
    supabase
      .from('drafts')
      .select('id, subject, recipient, confidence, category, status, updated_at')
      .eq('status', 'pending')
      .order('confidence', { ascending: false })
      .limit(50),
    supabase
      .from('drafts')
      .select('id, subject, recipient, confidence, category, status, updated_at')
      .eq('status', 'sent')
      .gte('updated_at', since24h)
      .order('updated_at', { ascending: false })
      .limit(50),
  ]);

  // Map backfill columns -> UI shape. Gmail backfill writes from_addr/subject_hash;
  // UI wants from_address/subject. Use the plaintext subject when stored, else
  // fall back to a short fingerprint from subject_hash. internal_date (epoch ms
  // string) is used when received_at hasn't been backfilled.
  type RawInbound = {
    id: string;
    from_addr: string | null;
    subject: string | null;
    subject_hash: string | null;
    received_at: string | null;
    internal_date: string | null;
    category: string | null;
  };
  const inbound: InboundRow[] = ((inboundRes.data ?? []) as RawInbound[]).map((r) => ({
    id: r.id,
    from_address: r.from_addr,
    subject: r.subject ?? (r.subject_hash ? `(hashed: ${r.subject_hash.slice(0, 8)}…)` : null),
    received_at:
      r.received_at ??
      (r.internal_date ? new Date(Number(r.internal_date)).toISOString() : null),
    category: r.category,
  }));

  return {
    inbound,
    pendingDrafts: (draftsRes.data ?? []) as DraftRow[],
    recentActivity: (activityRes.data ?? []) as DraftRow[],
  };
}

export default async function InboxPage() {
  const { inbound, pendingDrafts, recentActivity } = await fetchInbox();

  return (
    <main
      data-testid="inbox-dashboard"
      className="container mx-auto w-full max-w-full overflow-x-hidden px-4 py-6"
    >
      <header className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">Inbox</h1>
        <p className="text-sm text-slate-500">
          Latest activity across your connected mailboxes.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <LiveSection
          testId="section-inbound"
          title="Latest inbound"
          kind="inbound"
          table="email_messages"
          filter="is_outbound=eq.false"
          initialRows={inbound}
          emptyText="No recent inbound mail."
        />

        <LiveSection
          testId="section-pending-drafts"
          title="Pending drafts"
          kind="pending-draft"
          table="drafts"
          filter="status=eq.pending"
          initialRows={pendingDrafts}
          emptyText="No drafts pending approval."
        />

        <LiveSection
          testId="section-recent-activity"
          title="Recent activity"
          kind="sent-draft"
          table="drafts"
          filter="status=eq.sent"
          initialRows={recentActivity}
          emptyText="No auto-send activity in the last 24 hours."
        />
      </div>
    </main>
  );
}
