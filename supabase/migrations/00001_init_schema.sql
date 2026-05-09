-- Ainbox Database Schema - Migration 00001
-- Based on PRD §4 and §6.1 data inventory

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- USERS (extends auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  plan text not null default 'starter' check (plan in ('starter', 'pro', 'business')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================
-- OAUTH TOKENS (encrypted at rest via pgcrypto)
-- ============================================================
CREATE TABLE public.oauth_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook')),
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  scope text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own OAuth tokens"
  ON public.oauth_tokens FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- EMAIL MESSAGES
-- ============================================================
CREATE TABLE public.email_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_message_id text not null,
  thread_id text,
  provider text not null check (provider in ('gmail', 'outlook')),
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text not null,
  recipient text not null,
  subject text,
  body_encrypted text,  -- encrypted at rest per §4.3
  body_preview text,    -- plaintext preview, no PII
  category text check (category in ('sales','support','invoice','complaint','meeting','investor','urgent','escalation','spam','other')),
  category_confidence real,
  is_read boolean not null default false,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  UNIQUE(user_id, provider_message_id)
);
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own emails"
  ON public.email_messages FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_email_messages_user_received ON public.email_messages(user_id, received_at desc);
CREATE INDEX idx_email_messages_user_category ON public.email_messages(user_id, category);
CREATE INDEX idx_email_messages_thread ON public.email_messages(user_id, thread_id);

-- ============================================================
-- EMAIL SYNC STATE
-- ============================================================
CREATE TABLE public.email_sync_state (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook')),
  sync_type text not null check (sync_type in ('backfill', 'incremental')),
  status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'error')),
  delta_token text,              -- MS Graph delta token / Gmail historyId
  last_seq bigint,               -- for resume on failure
  total_count integer,
  synced_count integer default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  UNIQUE(user_id, provider, sync_type)
);
ALTER TABLE public.email_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own sync state"
  ON public.email_sync_state FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- KNOWLEDGE BASE ITEMS
-- ============================================================
CREATE TABLE public.kb_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kb_type text not null check (kb_type in ('faq','policy','pricing','preference','contact','signature','tone-sample')),
  content text not null,
  source_email_id uuid references public.email_messages(id) on delete set null,
  confidence real not null default 0,
  verified boolean not null default false,
  embedding vector(1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.kb_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own KB items"
  ON public.kb_items FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_kb_items_user_type ON public.kb_items(user_id, kb_type);
CREATE INDEX idx_kb_items_embedding ON public.kb_items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- DRAFTS
-- ============================================================
CREATE TABLE public.drafts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_id uuid not null references public.email_messages(id) on delete cascade,
  reply_body text not null,
  confidence real not null check (confidence >= 0 and confidence <= 1),
  retrieval_score real,
  generation_score real,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'sent', 'failed')),
  provider_draft_id text,        -- Gmail/Outlook draft id if created at provider
  kb_items_used uuid[],          -- references kb_items used in generation
  model text,
  cooling_until timestamptz,     -- 60s cooling for auto-send
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own drafts"
  ON public.drafts FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_drafts_user_status ON public.drafts(user_id, status);
CREATE INDEX idx_drafts_user_confidence ON public.drafts(user_id, confidence desc);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('classify', 'draft', 'send', 'reject', 'edit', 'delete_account', 'connect_provider', 'disconnect_provider', 'sync')),
  email_id uuid references public.email_messages(id) on delete set null,
  draft_id uuid references public.drafts(id) on delete set null,
  metadata jsonb,                -- model, confidence, kb_items used, etc. NO email body content
  created_at timestamptz not null default now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own audit log"
  ON public.audit_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert audit log"
  ON public.audit_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_audit_log_user_time ON public.audit_log(user_id, created_at desc);

-- ============================================================
-- AUTOMATION RULES
-- ============================================================
CREATE TABLE public.automation_rules (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('sales','support','invoice','complaint','meeting','investor','urgent','escalation','spam','other')),
  auto_send_enabled boolean not null default false,
  confidence_threshold real not null default 0.85 check (confidence_threshold >= 0.85),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  UNIQUE(user_id, category)
);
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own automation rules"
  ON public.automation_rules FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- DEFAULT AUTOMATION RULES (trigger on user creation)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data ->> 'full_name');

  -- Default automation: never auto-send complaints, legal, or investments
  INSERT INTO public.automation_rules (user_id, category, auto_send_enabled, confidence_threshold)
  VALUES
    (new.id, 'sales', true, 0.85),
    (new.id, 'support', true, 0.85),
    (new.id, 'invoice', true, 0.85),
    (new.id, 'meeting', true, 0.85),
    (new.id, 'faq', true, 0.85),
    (new.id, 'complaint', false, 0.85),
    (new.id, 'urgent', false, 0.85),
    (new.id, 'escalation', false, 0.85),
    (new.id, 'spam', false, 0.85),
    (new.id, 'other', false, 0.85);

  RETURN new;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
