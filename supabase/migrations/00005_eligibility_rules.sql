-- TASKRESPONSE-42 + TASKRESPONSE-44 / Eligibility L1.8 + L1.10
-- Hard-skip + thread-suppression rules baked into draftable_candidates().
-- Replaces the previous (looser) version of the same function.

DROP FUNCTION IF EXISTS public.draftable_candidates(int);

CREATE FUNCTION public.draftable_candidates(p_limit int DEFAULT 10)
RETURNS TABLE(
  id           uuid,
  user_id      uuid,
  subject      text,
  body_preview text,
  from_addr    text,
  category     text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $func$
SELECT em.id, em.user_id, em.subject, em.body_preview, em.from_addr, em.category
FROM public.email_messages em
LEFT JOIN public.drafts d ON d.email_id = em.id
LEFT JOIN auth.users u    ON u.id        = em.user_id
WHERE em.category IS NOT NULL
  AND em.category NOT IN ('spam','other')
  AND em.is_outbound = false
  AND d.id IS NULL
  /* L1.8: no-reply / mailer / automated sender patterns */
  AND LOWER(COALESCE(em.from_addr,'')) !~
      '(no.?reply|do.?not.?reply|notifications?|automated|mailer|noresponse|alerts?|updates?@|news@|marketing@|hello@|info@|noreply\.|do-not-reply)'
  /* L1.8: mailing list */
  AND em.list_id IS NULL
  AND em.list_unsubscribe IS NULL
  /* L1.8: auto-generated */
  AND (em.auto_submitted IS NULL OR em.auto_submitted ILIKE 'no')
  /* L1.8: precedence bulk/junk/list */
  AND (em.precedence IS NULL OR LOWER(em.precedence) NOT IN ('bulk','junk','list'))
  /* L1.8: mass send (>5 total recipients) */
  AND COALESCE(em.recipient_count, 1) <= 5
  /* L1.8: subject is a receipt / order / OOO */
  AND LOWER(COALESCE(em.subject,'')) !~
      '^(receipt|order #|order#|shipping|tracking|out of office|auto.?reply|payment received)'
  /* L1.8: sender = user themselves (forwarded to self) */
  AND (u.email IS NULL OR LOWER(em.from_addr) NOT LIKE '%' || LOWER(u.email) || '%')
  /* L1.8: user only on CC/BCC, not in To */
  AND (u.email IS NULL OR (
        LOWER(COALESCE(em.to_addr,'')) LIKE '%' || LOWER(u.email) || '%'
        OR (em.cc_addrs IS NULL AND em.bcc_addrs IS NULL)
      ))
  /* L1.10: user already sent reply in this thread */
  AND NOT EXISTS (
        SELECT 1 FROM public.email_messages sib
         WHERE sib.thread_id    = em.thread_id
           AND sib.user_id      = em.user_id
           AND sib.is_outbound  = true
      )
  /* L1.10: another draft already exists on this thread */
  AND NOT EXISTS (
        SELECT 1 FROM public.drafts d2
        JOIN public.email_messages sib ON sib.id = d2.email_id
         WHERE sib.thread_id   = em.thread_id
           AND d2.user_id      = em.user_id
           AND d2.status IN ('pending','approved','sent')
      )
ORDER BY em.received_at DESC NULLS LAST
LIMIT GREATEST(1, LEAST(50, p_limit));
$func$;

GRANT EXECUTE ON FUNCTION public.draftable_candidates(int) TO authenticated, service_role;
