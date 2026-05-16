/**
 * GET /api/account/duplicates
 *
 * Returns other profiles that share the same email as the authenticated user.
 * Uses the `find_duplicate_accounts` SECURITY DEFINER SQL function so that
 * cross-user-id lookups don't require a service-role key.
 *
 * AINBOX-50 — Merge L3
 *
 * Response: { duplicates: Array<{ id: string, email: string, created_at: string }> }
 */

import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data, error } = await supabase.rpc('find_duplicate_accounts');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ duplicates: data ?? [] });
}
