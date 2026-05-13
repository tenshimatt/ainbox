-- AINBOX-48: User account merge
--
-- merge_users(p_primary uuid, p_secondary uuid)
-- Reassigns all tenant data from the secondary user to the primary user,
-- then deletes the secondary profile row.  auth.users deletion is an
-- out-of-band admin operation (requires a separate service-role call).
--
-- Tables touched (in safe order to avoid FK violations):
--   email_messages, kb_items, drafts, draft_feedback, email_queue,
--   audit_log, audit_logs,
--   oauth_tokens (unique: user_id, provider)
--   email_sync_state (unique: user_id, provider)
--   automation_rules (unique: user_id, category)
--   automation_config (unique: user_id, category)
--   user_skills (unique: user_id, skill_id)
--   voice_profiles (unique: user_id)  — keep primary's row
--   profiles — delete secondary
--
-- For tables with a (user_id, X) unique constraint we re-assign rows
-- only where the primary does not already own a row for that X value;
-- orphaned secondary rows are then hard-deleted.
--
-- Security: SECURITY DEFINER so RLS can be bypassed for every table.
-- EXECUTE is REVOKED from authenticated; only service_role may call this.

CREATE OR REPLACE FUNCTION public.merge_users(
  p_primary   uuid,
  p_secondary uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_moved integer := 0;
  v_n          integer;
BEGIN
  -- ----------------------------------------------------------------
  -- Guards
  -- ----------------------------------------------------------------
  IF p_primary = p_secondary THEN
    RAISE EXCEPTION 'merge_users: primary and secondary must differ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_primary) THEN
    RAISE EXCEPTION 'merge_users: primary user % not found', p_primary;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_secondary) THEN
    RAISE EXCEPTION 'merge_users: secondary user % not found', p_secondary;
  END IF;

  -- ----------------------------------------------------------------
  -- Simple reassign tables (no unique composite with user_id)
  -- ----------------------------------------------------------------

  UPDATE public.email_messages SET user_id = p_primary WHERE user_id = p_secondary;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  UPDATE public.kb_items SET user_id = p_primary WHERE user_id = p_secondary;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  UPDATE public.drafts SET user_id = p_primary WHERE user_id = p_secondary;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  UPDATE public.draft_feedback SET user_id = p_primary WHERE user_id = p_secondary;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  UPDATE public.email_queue SET user_id = p_primary WHERE user_id = p_secondary;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  UPDATE public.audit_log SET user_id = p_primary WHERE user_id = p_secondary;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  UPDATE public.audit_logs SET user_id = p_primary WHERE user_id = p_secondary;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  -- ----------------------------------------------------------------
  -- oauth_tokens: unique (user_id, provider)
  -- Re-assign secondary rows where primary lacks that provider;
  -- delete remaining secondary rows (primary already covers that provider).
  -- ----------------------------------------------------------------
  UPDATE public.oauth_tokens
  SET user_id = p_primary
  WHERE user_id = p_secondary
    AND NOT EXISTS (
      SELECT 1 FROM public.oauth_tokens o2
      WHERE o2.user_id = p_primary AND o2.provider = oauth_tokens.provider
    );
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  DELETE FROM public.oauth_tokens WHERE user_id = p_secondary;

  -- ----------------------------------------------------------------
  -- email_sync_state: unique (user_id, provider)
  -- ----------------------------------------------------------------
  UPDATE public.email_sync_state
  SET user_id = p_primary
  WHERE user_id = p_secondary
    AND NOT EXISTS (
      SELECT 1 FROM public.email_sync_state s2
      WHERE s2.user_id = p_primary AND s2.provider = email_sync_state.provider
    );
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  DELETE FROM public.email_sync_state WHERE user_id = p_secondary;

  -- ----------------------------------------------------------------
  -- automation_rules: unique (user_id, category)
  -- ----------------------------------------------------------------
  UPDATE public.automation_rules
  SET user_id = p_primary
  WHERE user_id = p_secondary
    AND NOT EXISTS (
      SELECT 1 FROM public.automation_rules r2
      WHERE r2.user_id = p_primary AND r2.category = automation_rules.category
    );
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  DELETE FROM public.automation_rules WHERE user_id = p_secondary;

  -- ----------------------------------------------------------------
  -- automation_config: unique (user_id, category)
  -- ----------------------------------------------------------------
  UPDATE public.automation_config
  SET user_id = p_primary
  WHERE user_id = p_secondary
    AND NOT EXISTS (
      SELECT 1 FROM public.automation_config c2
      WHERE c2.user_id = p_primary AND c2.category = automation_config.category
    );
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  DELETE FROM public.automation_config WHERE user_id = p_secondary;

  -- ----------------------------------------------------------------
  -- user_skills: unique (user_id, skill_id)
  -- ----------------------------------------------------------------
  UPDATE public.user_skills
  SET user_id = p_primary
  WHERE user_id = p_secondary
    AND NOT EXISTS (
      SELECT 1 FROM public.user_skills sk2
      WHERE sk2.user_id = p_primary AND sk2.skill_id = user_skills.skill_id
    );
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows_moved := v_rows_moved + v_n;

  DELETE FROM public.user_skills WHERE user_id = p_secondary;

  -- ----------------------------------------------------------------
  -- voice_profiles: unique (user_id) — keep primary's; discard secondary's.
  -- ----------------------------------------------------------------
  DELETE FROM public.voice_profiles WHERE user_id = p_secondary;

  -- ----------------------------------------------------------------
  -- profiles: delete secondary (auth.users deletion is out-of-band).
  -- ----------------------------------------------------------------
  DELETE FROM public.profiles WHERE id = p_secondary;

  -- ----------------------------------------------------------------
  -- Audit the merge on the primary user's log.
  -- ----------------------------------------------------------------
  INSERT INTO public.audit_logs (user_id, event_type, entity_type, entity_id, action, details)
  VALUES (
    p_primary,
    'account_merge',
    'user',
    p_secondary,
    'merge',
    jsonb_build_object(
      'primary_id',   p_primary,
      'secondary_id', p_secondary,
      'rows_moved',   v_rows_moved
    )
  );

  RETURN jsonb_build_object(
    'ok',           true,
    'primary_id',   p_primary,
    'secondary_id', p_secondary,
    'rows_moved',   v_rows_moved
  );
END;
$$;

-- Only service_role may call this function.
REVOKE EXECUTE ON FUNCTION public.merge_users(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_users(uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.merge_users(uuid, uuid) TO service_role;
