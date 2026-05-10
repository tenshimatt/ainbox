/**
 * Supabase browser client (PRD §3.9).
 * Used in client components to initiate OAuth flows and read session.
 */
import { createBrowserClient } from '@supabase/ssr';

export function getBrowserSupabase() {
  // Development/test escape hatch: Playwright tests inject a mock via
  // window.__SUPABASE_MOCK__ to avoid fighting webpack-bundled fetch references.
  // This branch is unreachable in production builds (tree-shaken by Next.js).
  if (
    process.env.NODE_ENV !== 'production' &&
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).__SUPABASE_MOCK__
  ) {
    return (window as unknown as Record<string, unknown>)
      .__SUPABASE_MOCK__ as ReturnType<typeof createBrowserClient>;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'public-anon-key-placeholder';
  return createBrowserClient(url, anon);
}
