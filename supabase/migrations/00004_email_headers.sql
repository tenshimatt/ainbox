-- TASKRESPONSE-41 / Eligibility L1.7
-- Add the recipient + header columns needed for hard-skip rules.
-- Populated by the Gmail backfill (src/lib/sync/gmail.ts rowFromMessage).

ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS cc_addrs text[];
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS bcc_addrs text[];
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS reply_to text;
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS list_id text;
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS list_unsubscribe text;
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS auto_submitted text;
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS precedence text;
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS recipient_count integer;

CREATE INDEX IF NOT EXISTS idx_email_messages_list_id
  ON public.email_messages(user_id, list_id)
  WHERE list_id IS NOT NULL;
