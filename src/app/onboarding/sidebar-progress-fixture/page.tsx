/**
 * Test fixture page — renders OnboardingProgress inside a simulated sidebar.
 * Used exclusively by Playwright tests (sidebar-onboarding-progress.spec.ts).
 * Route is unprotected (/onboarding/*) so tests can reach it without auth.
 * Not linked from any production navigation.
 */
import { OnboardingProgress } from '@/components/sidebar/OnboardingProgress';

export default function SidebarProgressFixture() {
  return (
    <div
      data-testid="sidebar"
      aria-label="sidebar"
      className="w-64 border-r border-slate-200 bg-white min-h-screen"
    >
      <div className="flex h-16 items-center border-b border-slate-200 px-4">
        <span className="text-lg font-bold text-slate-900">Ainbox</span>
      </div>
      <OnboardingProgress />
    </div>
  );
}
