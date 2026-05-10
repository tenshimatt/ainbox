-- AINBOX-16: kb-extract edge function
-- PRD: §4.4 §7.6 §7.7
--
-- Adds kb_extracted_at to email_messages so the kb-extract edge function
-- (and the Next.js /api/kb/extract route) can track which emails have already
-- been processed for knowledge extraction. NULL = not yet processed.
--
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS kb_extracted_at timestamptz;

CREATE INDEX IF NOT EXISTS email_messages_kb_extracted_idx
  ON public.email_messages (user_id)
  WHERE kb_extracted_at IS NULL;

COMMENT ON COLUMN public.email_messages.kb_extracted_at IS
  'Timestamp when this email was processed by the kb-extract job. NULL = pending.';
