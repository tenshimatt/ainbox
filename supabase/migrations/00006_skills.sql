-- AINBOX-46 / Personalization L4 — user_skills table
-- Stores per-user skill-toggle state. Skill definitions (labels, descriptions,
-- prompt instructions) live in src/lib/skills/skills.ts; only the ids live here.

CREATE TABLE public.user_skills (
  user_id  uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_id text    NOT NULL,
  enabled  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, skill_id)
);

ALTER TABLE public.user_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own skills"
  ON public.user_skills
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
