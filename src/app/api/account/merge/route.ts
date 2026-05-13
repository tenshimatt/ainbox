/**
 * POST /api/account/merge
 *
 * AINBOX-49: Merge L2 — service-only invocation of merge_users().
 *
 * Merges all data owned by `secondary_user_id` into `primary_user_id`
 * by calling the `merge_users` Postgres SECURITY DEFINER function.
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>`.  This endpoint
 * is not user-facing — it is called by the account-consolidation workflow
 * running on the Archon harness after identity verification.
 *
 * Uses the Supabase service-role key (system action, not user-initiated).
 * Per CLAUDE.md hard rule: service-role is only used when unavoidable for
 * cross-tenant / system operations, and only behind CRON_SECRET validation.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleMergeRequest, type MergeUsersDeps } from '@/lib/account/merge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? '';

  const deps: MergeUsersDeps = {
    validateSecret: (auth) => !!cronSecret && auth === `Bearer ${cronSecret}`,

    mergeRpc: async (primaryUserId, secondaryUserId) => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );
      return supabase.rpc('merge_users', {
        primary_user_id: primaryUserId,
        secondary_user_id: secondaryUserId,
      });
    },
  };

  const response = await handleMergeRequest(req, deps);
  // Convert the Web API Response to a NextResponse
  const body = await response.json();
  return NextResponse.json(body, { status: response.status });
}
