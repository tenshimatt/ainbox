import { DraftQueue } from '@/components/drafts/DraftQueue';

export const dynamic = 'force-dynamic';

/**
 * /drafts — Approval queue (PRD §5.3, §7.11).
 *
 * Server component shell; the client `<DraftQueue>` fetches `/api/drafts`
 * (TASKRESPONSE-10) on mount, renders sorted by confidence DESC, then created_at DESC,
 * and stays in sync via Supabase Realtime. Approve/Reject/Edit buttons live in
 * <DraftRow>. Keyboard shortcuts j/k/a/r per PRD §8.3.
 */
export default function DraftsPage() {
  return (
    <main className="mx-auto w-full max-w-full px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Drafts</h1>
        <p className="mt-1 text-sm text-slate-600">
          Pending drafts ranked by confidence. Use j/k to navigate, a to approve, r to reject.
        </p>
      </header>
      <DraftQueue initial={[]} />
    </main>
  );
}
