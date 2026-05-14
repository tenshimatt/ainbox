-- TASKRESPONSE-51: KB near-duplicate guard (cosine 0.9 threshold)
--
-- Returns true when the user already has a KB item of the same kb_type
-- whose embedding has cosine similarity >= p_threshold to p_embedding.
-- Used by kb-extract (service role) and embeddings/index (authenticated)
-- to skip near-duplicate inserts before they hit the table.
--
-- Security: SECURITY INVOKER — RLS applies for authenticated callers.
-- The explicit user_id filter also enforces tenant isolation for
-- service-role callers (kb-extract edge function).

CREATE OR REPLACE FUNCTION public.kb_near_duplicate_exists(
  p_user_id   uuid,
  p_kb_type   text,
  p_embedding vector(1024),
  p_threshold float DEFAULT 0.9
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.kb_items
    WHERE user_id  = p_user_id
      AND kb_type  = p_kb_type
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> p_embedding) >= p_threshold
    LIMIT 1
  );
$$;

GRANT EXECUTE ON FUNCTION public.kb_near_duplicate_exists(uuid, text, vector, float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_near_duplicate_exists(uuid, text, vector, float) TO service_role;
