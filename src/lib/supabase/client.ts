/**
 * Supabase browser client (PRD §3.9).
 * Used in client components to initiate OAuth flows and read session.
 */
import { createBrowserClient } from '@supabase/ssr';

export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'public-anon-key-placeholder';
  return createBrowserClient(url, anon);
}
