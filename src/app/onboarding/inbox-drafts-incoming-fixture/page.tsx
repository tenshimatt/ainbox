/**
 * Test fixture page — renders DraftsIncomingBanner + LiveSection (pending-drafts)
 * in isolation without requiring auth.
 *
 * Used exclusively by Playwright tests (inbox-drafts-incoming.spec.ts).
 * Route is unprotected (/onboarding/*) so tests can reach it without a
 * Supabase auth session. Not linked from any production navigation.
 *
 * TASK7544-24: /inbox 'drafts incoming' banner + Realtime auto-prepend
 */
import DraftsIncomingBanner from '@/components/inbox/DraftsIncomingBanner';
import { LiveSection } from '@/components/inbox/LiveSection';

export default function InboxDraftsIncomingFixture() {
  return (
    <main
      data-testid="inbox-dashboard"
      className="container mx-auto w-full max-w-full overflow-x-hidden px-4 py-6"
    >
      <DraftsIncomingBanner />

      <div className="flex flex-col gap-6">
        <LiveSection
          testId="section-pending-drafts"
          title="Pending drafts"
          kind="pending-draft"
          table="drafts"
          filter="status=eq.pending"
          initialRows={[]}
          emptyText="No drafts pending approval."
        />
      </div>
    </main>
  );
}
