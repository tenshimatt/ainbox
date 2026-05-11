-- AINBOX-36 / Personalization Layer 1
-- Capture every user action on a draft (approve/reject/edit/send/snooze)
-- so subsequent layers (rules, few-shot, voice) have signal to mine.
--
-- PRD §4.1 RLS, §7.11 Approval queue action taxonomy.

CREATE TABLE IF NOT EXISTS public.draft_feedback (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  email_id uuid REFERENCES public.email_messages(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('approve','reject','edit','send','snooze')),
  edit_diff jsonb,
  latency_ms integer,
  category text,
  sender_domain text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draft_feedback_user_action
  ON public.draft_feedback(user_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_draft_feedback_sender
  ON public.draft_feedback(user_id, sender_domain);

ALTER TABLE public.draft_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS draft_feedback_owner ON public.draft_feedback;
CREATE POLICY draft_feedback_owner ON public.draft_feedback FOR ALL USING (auth.uid() = user_id);

GRANT ALL ON public.draft_feedback TO authenticated, service_role;
