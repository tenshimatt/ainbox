-- Migration: §X.Y Personalization L5 — voice prompt synthesis
--
-- TASKRESPONSE-47: Nightly job synthesises a per-user tone/voice guide from their
-- KB items (especially tone-samples) and stores it in voice_profiles.
-- The draft edge function injects this prompt to match the user's writing voice.
--
-- New objects:
--   • public.voice_profiles   — one row per user, updated nightly
--   • cron job voice-prompt-nightly — fires at 02:00 UTC daily

-- ============================================================
-- VOICE PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voice_profiles (
  id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_prompt      text        NOT NULL,
  kb_item_count     integer     NOT NULL DEFAULT 0,
  tone_sample_count integer     NOT NULL DEFAULT 0,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own voice profile (e.g. settings page preview).
-- The nightly cron runs as service-role and bypasses RLS.
CREATE POLICY "voice_profiles_owner_select"
  ON public.voice_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Index for fast lookup by the draft edge function.
CREATE INDEX IF NOT EXISTS idx_voice_profiles_user
  ON public.voice_profiles (user_id);

-- ============================================================
-- pg_cron: nightly voice-prompt synthesis at 02:00 UTC
-- ============================================================
-- Prerequisites (same as 00004_delta_cron.sql):
--   vault secrets: supabase_url, cron_secret
--
SELECT cron.schedule(
  'voice-prompt-nightly',   -- job name (unique; idempotent re-run)
  '0 2 * * *',              -- 02:00 UTC every day
  $$
  SELECT
    net.http_post(
      url     := (
                   SELECT decrypted_secret
                   FROM   vault.decrypted_secrets
                   WHERE  name = 'supabase_url'
                 ) || '/functions/v1/voice-prompt',
      headers := jsonb_build_object(
                   'Authorization',
                   'Bearer ' || (
                     SELECT decrypted_secret
                     FROM   vault.decrypted_secrets
                     WHERE  name = 'cron_secret'
                   ),
                   'Content-Type', 'application/json'
                 ),
      body    := '{}'::jsonb
    ) AS request_id
  $$
);
