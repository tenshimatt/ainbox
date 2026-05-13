-- AINBOX-49: Merge L2 — merge_users() Postgres function
--
-- Reassigns all rows owned by secondary_user_id to primary_user_id,
-- skipping rows that would violate unique constraints (primary already
-- has the same provider/message).  Writes an audit entry for the primary
-- user and returns a jsonb summary.
--
-- SECURITY DEFINER: callable only via service-role (grants below revoke
-- public/anon/authenticated access).  Never exposed to user-facing
-- edge functions — only via the /api/account/merge route which validates
-- CRON_SECRET first.

CREATE OR REPLACE FUNCTION public.merge_users(
  primary_user_id   uuid,
  secondary_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tables_reassigned text[] := '{}';
  rows_moved        int    := 0;
  n                 int;
BEGIN
  IF primary_user_id = secondary_user_id THEN
    RAISE EXCEPTION 'merge_users: primary_user_id and secondary_user_id must differ';
  END IF;

  -- oauth_tokens: UNIQUE(user_id, provider) — skip if primary already has row
  UPDATE public.oauth_tokens t
    SET user_id = primary_user_id
    WHERE t.user_id = secondary_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.oauth_tokens o2
        WHERE o2.user_id = primary_user_id AND o2.provider = t.provider
      );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    tables_reassigned := array_append(tables_reassigned, 'oauth_tokens');
    rows_moved := rows_moved + n;
  END IF;

  -- email_messages: UNIQUE(user_id, provider, provider_message_id)
  UPDATE public.email_messages t
    SET user_id = primary_user_id
    WHERE t.user_id = secondary_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.email_messages e2
        WHERE e2.user_id          = primary_user_id
          AND e2.provider         = t.provider
          AND e2.provider_message_id = t.provider_message_id
      );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    tables_reassigned := array_append(tables_reassigned, 'email_messages');
    rows_moved := rows_moved + n;
  END IF;

  -- email_sync_state: UNIQUE(user_id, provider)
  UPDATE public.email_sync_state t
    SET user_id = primary_user_id
    WHERE t.user_id = secondary_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.email_sync_state s2
        WHERE s2.user_id  = primary_user_id AND s2.provider = t.provider
      );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    tables_reassigned := array_append(tables_reassigned, 'email_sync_state');
    rows_moved := rows_moved + n;
  END IF;

  -- kb_items: no unique constraint beyond PK — reassign all
  UPDATE public.kb_items
    SET user_id = primary_user_id
    WHERE user_id = secondary_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    tables_reassigned := array_append(tables_reassigned, 'kb_items');
    rows_moved := rows_moved + n;
  END IF;

  -- drafts: no cross-user unique — reassign all
  UPDATE public.drafts
    SET user_id = primary_user_id
    WHERE user_id = secondary_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    tables_reassigned := array_append(tables_reassigned, 'drafts');
    rows_moved := rows_moved + n;
  END IF;

  -- audit_log: history belongs to primary going forward
  UPDATE public.audit_log
    SET user_id = primary_user_id
    WHERE user_id = secondary_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    tables_reassigned := array_append(tables_reassigned, 'audit_log');
    rows_moved := rows_moved + n;
  END IF;

  -- automation_rules: UNIQUE(user_id, category) — skip conflicts
  UPDATE public.automation_rules t
    SET user_id = primary_user_id
    WHERE t.user_id = secondary_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.automation_rules r2
        WHERE r2.user_id = primary_user_id AND r2.category = t.category
      );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    tables_reassigned := array_append(tables_reassigned, 'automation_rules');
    rows_moved := rows_moved + n;
  END IF;

  -- automation_config: UNIQUE(user_id, category) — skip conflicts
  UPDATE public.automation_config t
    SET user_id = primary_user_id
    WHERE t.user_id = secondary_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.automation_config c2
        WHERE c2.user_id = primary_user_id AND c2.category = t.category
      );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    tables_reassigned := array_append(tables_reassigned, 'automation_config');
    rows_moved := rows_moved + n;
  END IF;

  -- Audit trail written to primary user's log
  INSERT INTO public.audit_log(user_id, action, meta)
  VALUES (
    primary_user_id,
    'account_merged',
    jsonb_build_object(
      'secondary_user_id',  secondary_user_id,
      'tables_reassigned',  to_jsonb(tables_reassigned),
      'rows_moved',         rows_moved,
      'merged_at',          now()
    )
  );

  RETURN jsonb_build_object(
    'ok',                  true,
    'primary_user_id',     primary_user_id,
    'secondary_user_id',   secondary_user_id,
    'tables_reassigned',   to_jsonb(tables_reassigned),
    'rows_moved',          rows_moved
  );
END;
$$;

-- Restrict to service_role only — users must never call this directly.
REVOKE ALL ON FUNCTION public.merge_users(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_users(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.merge_users(uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.merge_users(uuid, uuid) TO service_role;
