-- TASKRESPONSE-47 / Personalization L5 — voice_profiles table
-- Stores per-user synthesised voice prompt (200-word style guide)
-- rebuilt nightly from verified KB items + approved drafts.
CREATE TABLE IF NOT EXISTS public.voice_profiles (
  user_id      uuid       PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_prompt text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_profiles_owner ON public.voice_profiles;
CREATE POLICY voice_profiles_owner ON public.voice_profiles FOR ALL USING (auth.uid() = user_id);
GRANT ALL ON public.voice_profiles TO authenticated, service_role;
