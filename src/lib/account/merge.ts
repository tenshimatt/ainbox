/**
 * account/merge — injectable handler for the /api/account/merge route.
 *
 * AINBOX-49: Merge L2
 *
 * Validates the CRON_SECRET bearer, extracts + validates the two user IDs,
 * then delegates to the `merge_users` Postgres function (SECURITY DEFINER)
 * via the supplied RPC caller.  All cross-tenant data movement happens
 * inside that single SQL transaction.
 *
 * The deps interface keeps the handler unit-testable without a live
 * Supabase instance.
 */

export interface MergeUsersDeps {
  /** Returns true if the Authorization header is the valid service bearer. */
  validateSecret: (authHeader: string) => boolean;
  /**
   * Calls the merge_users(primary, secondary) Postgres RPC.
   * Must be implemented with a service-role Supabase client.
   */
  mergeRpc: (
    primaryUserId: string,
    secondaryUserId: string,
  ) => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
}

export async function handleMergeRequest(
  req: Request,
  deps: MergeUsersDeps,
): Promise<Response> {
  // --- auth ---
  const authHeader = req.headers.get('authorization') ?? '';
  if (!deps.validateSecret(authHeader)) {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }

  // --- parse body ---
  let primary_user_id: unknown;
  let secondary_user_id: unknown;
  try {
    const body = await req.json();
    primary_user_id = body?.primary_user_id;
    secondary_user_id = body?.secondary_user_id;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!primary_user_id || typeof primary_user_id !== 'string') {
    return Response.json({ error: 'primary_user_id_required' }, { status: 400 });
  }
  if (!secondary_user_id || typeof secondary_user_id !== 'string') {
    return Response.json({ error: 'secondary_user_id_required' }, { status: 400 });
  }
  if (primary_user_id === secondary_user_id) {
    return Response.json({ error: 'user_ids_must_differ' }, { status: 400 });
  }

  // --- call Postgres ---
  const { data, error } = await deps.mergeRpc(primary_user_id, secondary_user_id);

  if (error) {
    return Response.json(
      { error: 'merge_failed', detail: error.message },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, ...(data ?? {}) });
}
