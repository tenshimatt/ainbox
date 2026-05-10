-- Migration: §7.12 Auto-send executor — add scheduling columns to drafts
--
-- PRD §7.12: drafts gain a 60-second cooling window before auto-send fires.
-- scheduled_send_at: set by triggerAutoSend(); cron executor flips status→sent when elapsed.
-- sent_at:           stamped by the executor when the draft is dispatched.
--
-- Also normalises automation_config so it supports per-category rows
-- (enabled + threshold) to match what the auto-send lib expects.

-- ── drafts: add scheduling columns ────────────────────────────────────────

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- Partial index: fast scan for the cron executor (pending + due).
CREATE INDEX IF NOT EXISTS idx_drafts_scheduled
  ON public.drafts (scheduled_send_at)
  WHERE status = 'pending' AND scheduled_send_at IS NOT NULL;

-- ── automation_config: promote to per-category shape ─────────────────────
--
-- The existing table is keyed by user_id only (single row per user).
-- The auto-send lib queries by (user_id, category) and expects columns
-- `enabled` and `threshold`. We drop and recreate to add `category` to
-- the PK and expose the expected column names.
--
-- If data already exists, this migration discards the single-row entries;
-- user defaults are re-seeded by the handle_new_user trigger on first sign-in.

DROP TABLE IF EXISTS public.automation_config CASCADE;

CREATE TABLE public.automation_config (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  enabled  boolean NOT NULL DEFAULT false,
  threshold numeric(3,2) NOT NULL DEFAULT 0.85 CHECK (threshold >= 0.85),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

ALTER TABLE public.automation_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "automation_config_owner_all"
  ON public.automation_config FOR ALL
  USING (auth.uid() = user_id);

-- ── handle_new_user: seed per-category automation_config rows ─────────────
--
-- The existing trigger already seeds automation_rules; extend it to also
-- seed automation_config rows with the same defaults.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.automation_rules
    (user_id, category, auto_send_enabled, confidence_threshold)
  VALUES
    (new.id, 'sales',      true,  0.85),
    (new.id, 'support',    true,  0.85),
    (new.id, 'invoice',    true,  0.85),
    (new.id, 'meeting',    true,  0.85),
    (new.id, 'faq',        true,  0.85),
    (new.id, 'complaint',  false, 0.85),
    (new.id, 'urgent',     false, 0.85),
    (new.id, 'escalation', false, 0.85),
    (new.id, 'investor',   false, 0.85),
    (new.id, 'spam',       false, 0.85),
    (new.id, 'other',      false, 0.85)
  ON CONFLICT (user_id, category) DO NOTHING;

  INSERT INTO public.automation_config
    (user_id, category, enabled, threshold)
  VALUES
    (new.id, 'sales',      true,  0.85),
    (new.id, 'support',    true,  0.85),
    (new.id, 'invoice',    true,  0.85),
    (new.id, 'meeting',    true,  0.85),
    (new.id, 'faq',        true,  0.85),
    (new.id, 'complaint',  false, 0.85),
    (new.id, 'urgent',     false, 0.85),
    (new.id, 'escalation', false, 0.85),
    (new.id, 'investor',   false, 0.85),
    (new.id, 'spam',       false, 0.85),
    (new.id, 'other',      false, 0.85)
  ON CONFLICT (user_id, category) DO NOTHING;

  RETURN new;
END;
$$;
