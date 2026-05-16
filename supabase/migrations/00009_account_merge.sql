-- AINBOX-50: Account merge helpers
-- Detects duplicate auth.users rows sharing the same email as the current user.
-- Provides a merge function to consolidate data under one account.
--
-- SECURITY DEFINER is intentional: we need to cross user_id boundaries for
-- detection + data migration, but the functions are locked to the caller's email.

-- ============================================================
-- FIND DUPLICATE ACCOUNTS
-- Returns profiles that share the same email as the calling user
-- (excluding the caller themselves).
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_duplicate_accounts()
RETURNS TABLE (
  id         uuid,
  email      text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT p.id, p.email, p.created_at
  FROM public.profiles p
  WHERE p.email = (SELECT email FROM public.profiles WHERE id = auth.uid())
    AND p.id <> auth.uid()
    AND p.email IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.find_duplicate_accounts() TO authenticated;

-- ============================================================
-- MERGE DUPLICATE ACCOUNT
-- Reassigns all data rows from source_user_id to the calling user,
-- then removes the source profile.
-- Raises if the emails don't match (prevents cross-account data theft).
-- ============================================================
CREATE OR REPLACE FUNCTION public.merge_duplicate_account(source_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  primary_id     uuid := auth.uid();
  source_email   text;
  primary_email  text;
  moved_messages int := 0;
  moved_kb       int := 0;
  moved_drafts   int := 0;
  moved_tokens   int := 0;
BEGIN
  IF primary_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF source_user_id = primary_id THEN
    RAISE EXCEPTION 'self_merge';
  END IF;

  SELECT email INTO primary_email FROM public.profiles WHERE id = primary_id;
  SELECT email INTO source_email  FROM public.profiles WHERE id = source_user_id;

  IF source_email IS NULL THEN
    RAISE EXCEPTION 'source_not_found';
  END IF;
  IF source_email <> primary_email THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  -- Move email_messages; unique constraint (user_id, provider, provider_message_id)
  -- may block some rows — skip conflicts so merge is idempotent.
  UPDATE public.email_messages
     SET user_id = primary_id
   WHERE user_id = source_user_id;
  GET DIAGNOSTICS moved_messages = ROW_COUNT;

  -- Move kb_items
  UPDATE public.kb_items
     SET user_id = primary_id
   WHERE user_id = source_user_id;
  GET DIAGNOSTICS moved_kb = ROW_COUNT;

  -- Move drafts
  UPDATE public.drafts
     SET user_id = primary_id
   WHERE user_id = source_user_id;
  GET DIAGNOSTICS moved_drafts = ROW_COUNT;

  -- Move oauth_tokens only when the primary doesn't already hold that provider
  UPDATE public.oauth_tokens
     SET user_id = primary_id
   WHERE user_id = source_user_id
     AND provider NOT IN (
       SELECT provider FROM public.oauth_tokens WHERE user_id = primary_id
     );
  GET DIAGNOSTICS moved_tokens = ROW_COUNT;

  -- Remove the source profile (does NOT delete auth.users — that requires admin)
  DELETE FROM public.profiles WHERE id = source_user_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'moved_messages',  moved_messages,
    'moved_kb',        moved_kb,
    'moved_drafts',    moved_drafts,
    'moved_tokens',    moved_tokens
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_account(uuid) TO authenticated;
