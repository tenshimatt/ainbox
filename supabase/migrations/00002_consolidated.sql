-- Consolidated Ainbox Schema (00002)
-- Replaces and supersedes 00001_init_schema.sql, 0001_init.sql,
-- 0002_embeddings_trigger.sql, 20250608_ainbox_schema.sql.
--
-- These prior migrations were produced in parallel by different agents
-- and disagree on table names + column names. This file is the union of
-- what merged code actually queries (from grep over src/ + supabase/functions/).
--
-- PRD anchors: §4 (data inventory), §4.1 (RLS), §4.2 (OAuth tokens),
-- §4.3 (encrypted bodies), §3.7 (embeddings 1024d bge-m3).

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  plan text not null default 'starter' check (plan in ('starter','pro','business')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_owner_select" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_owner_update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- ============================================================
-- OAUTH TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.oauth_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail','outlook')),
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  scope text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  UNIQUE(user_id, provider)
);
ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oauth_tokens_owner_all" ON public.oauth_tokens FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- EMAIL MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_message_id text not null,
  thread_id text,
  provider text not null check (provider in ('gmail','outlook')),
  direction text not null check (direction in ('inbound','outbound')),
  sender text not null,
  recipient text not null,
  subject text,
  body_encrypted text,
  body_preview text,
  category text check (category in ('sales','support','invoice','complaint','meeting','investor','urgent','escalation','spam','faq','other')),
  category_confidence real,
  is_read boolean not null default false,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  UNIQUE(user_id, provider, provider_message_id)
);
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_messages_owner_all" ON public.email_messages FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_user_received ON public.email_messages(user_id, received_at desc);
CREATE INDEX IF NOT EXISTS idx_email_messages_user_category ON public.email_messages(user_id, category);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON public.email_messages(user_id, thread_id);

-- ============================================================
-- EMAIL SYNC STATE (Gmail historyId / Graph delta token)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_sync_state (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail','outlook')),
  sync_type text not null default 'incremental' check (sync_type in ('backfill','incremental')),
  status text not null default 'pending' check (status in ('pending','running','complete','error')),
  delta_token text,
  history_id text,
  last_seq bigint,
  total_count integer,
  synced_count integer default 0,
  last_synced_at timestamptz,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  UNIQUE(user_id, provider)
);
ALTER TABLE public.email_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_sync_state_owner_all" ON public.email_sync_state FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- KB ITEMS (with embeddings)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.kb_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kb_type text not null check (kb_type in ('faq','policy','pricing','preference','contact','signature','tone-sample')),
  content text not null,
  source_email_id uuid references public.email_messages(id) on delete set null,
  source_id text,
  chunk_index integer default 0,
  confidence real not null default 0,
  verified boolean not null default false,
  embedding vector(1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.kb_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb_items_owner_all" ON public.kb_items FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_kb_items_user_type ON public.kb_items(user_id, kb_type);
CREATE INDEX IF NOT EXISTS idx_kb_items_embedding ON public.kb_items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Re-embed trigger (clear embedding on content change)
CREATE OR REPLACE FUNCTION public.kb_items_clear_embedding_on_content_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (tg_op = 'UPDATE') AND (new.content IS DISTINCT FROM old.content) THEN
    new.embedding := NULL;
    new.updated_at := now();
  END IF;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS trg_kb_items_reembed ON public.kb_items;
CREATE TRIGGER trg_kb_items_reembed
  BEFORE UPDATE ON public.kb_items
  FOR EACH ROW EXECUTE FUNCTION public.kb_items_clear_embedding_on_content_change();

-- Cosine-similarity match RPC (RLS-safe via SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.match_kb_items(
  query_embedding vector(1024),
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  kb_type text,
  content text,
  source_id text,
  chunk_index int,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT kb.id, kb.kb_type, kb.content, kb.source_id, kb.chunk_index,
         1 - (kb.embedding <=> query_embedding) AS similarity
  FROM public.kb_items kb
  WHERE kb.embedding IS NOT NULL
  ORDER BY kb.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(50, match_count));
$$;
GRANT EXECUTE ON FUNCTION public.match_kb_items(vector, int) TO authenticated;

-- ============================================================
-- DRAFTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.drafts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_id uuid not null references public.email_messages(id) on delete cascade,
  reply_body text not null,
  confidence real not null check (confidence >= 0 and confidence <= 1),
  retrieval_score real,
  generation_score real,
  status text not null default 'pending' check (status in ('pending','approved','rejected','sent','failed')),
  provider_draft_id text,
  kb_items_used uuid[],
  model text,
  cooling_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drafts_owner_all" ON public.drafts FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user_status ON public.drafts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_drafts_user_confidence ON public.drafts(user_id, confidence desc);

-- ============================================================
-- AUDIT LOG (canonical; singular)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  email_id uuid references public.email_messages(id) on delete set null,
  draft_id uuid references public.drafts(id) on delete set null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_owner_select" ON public.audit_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "audit_log_owner_insert" ON public.audit_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON public.audit_log(user_id, created_at desc);

-- audit_logs (plural) — separate real table for classify edge fn.
-- supabase/functions/classify and src/lib/classify write here using
-- (action, details) shape; not worth re-routing into audit_log.
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text,
  entity_type text,
  entity_id text,
  action text not null,
  details jsonb default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_owner_select" ON public.audit_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "audit_logs_owner_insert" ON public.audit_logs FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON public.audit_logs(user_id, created_at desc);

-- ============================================================
-- AUTOMATION RULES (per-category) + automation_config alias
-- ============================================================
CREATE TABLE IF NOT EXISTS public.automation_rules (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('sales','support','invoice','complaint','meeting','investor','urgent','escalation','spam','faq','other')),
  auto_send_enabled boolean not null default false,
  confidence_threshold real not null default 0.85 check (confidence_threshold >= 0.85),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  UNIQUE(user_id, category)
);
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automation_rules_owner_all" ON public.automation_rules FOR ALL USING (auth.uid() = user_id);

-- automation_config (used by 4 code paths) — separate table since it has
-- different shape (single row per user, no category breakdown).
CREATE TABLE IF NOT EXISTS public.automation_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  category text,
  auto_send boolean not null default false,
  threshold numeric(3,2) not null default 0.85 check (threshold >= 0.85),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.automation_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automation_config_owner_all" ON public.automation_config FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- EMAIL QUEUE (for background AI tasks: classify, embed, draft, auto_send)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_queue (
  id uuid primary key default uuid_generate_v4(),
  email_id uuid not null references public.email_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  task_type text not null check (task_type in ('classify','summarize','embed','draft','auto_send')),
  priority integer default 0,
  attempts integer default 0,
  max_attempts integer default 3,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_queue_service_only" ON public.email_queue FOR ALL USING (auth.role() = 'service_role');
CREATE INDEX IF NOT EXISTS idx_email_queue_status_priority ON public.email_queue(status, priority desc, created_at);
CREATE INDEX IF NOT EXISTS idx_email_queue_user ON public.email_queue(user_id);

-- ============================================================
-- handle_new_user: bootstrap profile + default automation rules
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.automation_rules (user_id, category, auto_send_enabled, confidence_threshold) VALUES
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

  INSERT INTO public.automation_config (user_id) VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Table-level GRANTs (RLS still enforces row ownership)
-- Supabase's default ALTER DEFAULT PRIVILEGES depends on who ran the
-- CREATE TABLE — running this explicitly avoids "permission denied for
-- table" errors when the authenticated role tries to upsert.
-- ============================================================
GRANT INSERT, UPDATE, SELECT, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, UPDATE, SELECT, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
