-- Ainbox Schema Migration
-- Tables: users (managed by Supabase Auth), connected_accounts, emails,
--        knowledge_entries, draft_replies, automation_rules, audit_logs
-- Extensions: pgvector for embeddings
-- RLS on all tables

-- 1. Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text NOT NULL,
    display_name text,
    avatar_url text,
    preferences jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own data"
    ON public.users FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own data"
    ON public.users FOR UPDATE
    USING (auth.uid() = id);

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.users (id, email, display_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 3. Connected email accounts (Gmail, Outlook)
CREATE TABLE IF NOT EXISTS public.connected_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
    email text NOT NULL,
    -- Encrypted OAuth tokens stored in Supabase Vault / secrets manager
    -- Actual tokens stored in vault, this links to them
    refresh_token_ref text,
    access_token_ref text,
    sync_enabled boolean DEFAULT true,
    last_sync_at timestamptz,
    sync_status text DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, email)
);
ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own connected accounts"
    ON public.connected_accounts FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connected accounts"
    ON public.connected_accounts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connected accounts"
    ON public.connected_accounts FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own connected accounts"
    ON public.connected_accounts FOR DELETE
    USING (auth.uid() = user_id);

-- 4. Emails (inbound + outbound, synced from Gmail/MS Graph)
CREATE TABLE IF NOT EXISTS public.emails (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    provider_email_id text NOT NULL,           -- Gmail/MS message ID for dedup
    thread_id text,                            -- Gmail thread ID / MS Graph conversation ID
    from_address text NOT NULL,
    to_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
    cc_addresses jsonb DEFAULT '[]'::jsonb,
    bcc_addresses jsonb DEFAULT '[]'::jsonb,
    subject text,
    -- Body stored encrypted; redacted in logs/audit
    body_encrypted text,
    body_plain_preview text,                   -- First 200 chars, for search indexing
    has_attachments boolean DEFAULT false,
    attachment_metadata jsonb DEFAULT '[]'::jsonb,
    received_at timestamptz NOT NULL,
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    is_read boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    is_starred boolean DEFAULT false,
    labels jsonb DEFAULT '[]'::jsonb,
    folder text DEFAULT 'INBOX',
    -- AI processing state
    ai_processed boolean DEFAULT false,
    ai_classification text,                    -- 'urgent', 'normal', 'newsletter', 'spam'
    ai_summary text,
    ai_suggested_action text,                  -- 'reply', 'archive', 'task', 'delegate'
    -- Embeddings for knowledge retrieval
    embedding vector(1024),
    created_at timestamptz DEFAULT now(),
    UNIQUE(account_id, provider_email_id)
);
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own emails"
    ON public.emails FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own emails"
    ON public.emails FOR UPDATE
    USING (auth.uid() = user_id);

-- Index for dedup lookups
CREATE INDEX IF NOT EXISTS idx_emails_provider_id ON public.emails(account_id, provider_email_id);
-- Index for inbox queries
CREATE INDEX IF NOT EXISTS idx_emails_inbox ON public.emails(user_id, folder, received_at DESC);
-- Vector similarity index
CREATE INDEX IF NOT EXISTS idx_emails_embedding ON public.emails USING hnsw (embedding vector_cosine_ops);

-- 5. Knowledge entries (extracted from emails, user-added)
CREATE TABLE IF NOT EXISTS public.knowledge_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    source_email_id uuid REFERENCES public.emails(id) ON DELETE SET NULL,
    title text NOT NULL,
    content text NOT NULL,
    content_type text DEFAULT 'note' CHECK (content_type IN ('note', 'summary', 'fact', 'contact', 'reference', 'todo')),
    tags jsonb DEFAULT '[]'::jsonb,
    embedding vector(1024),
    confidence float DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.knowledge_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own knowledge"
    ON public.knowledge_entries FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own knowledge"
    ON public.knowledge_entries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own knowledge"
    ON public.knowledge_entries FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own knowledge"
    ON public.knowledge_entries FOR DELETE
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON public.knowledge_entries USING hnsw (embedding vector_cosine_ops);

-- 6. Draft replies (AI-generated, awaiting approval)
CREATE TABLE IF NOT EXISTS public.draft_replies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    email_id uuid NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
    draft_text text NOT NULL,
    tone text DEFAULT 'professional' CHECK (tone IN ('professional', 'friendly', 'formal', 'urgent')),
    confidence float NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sent', 'edited')),
    rejection_reason text,
    edited_by_user boolean DEFAULT false,
    original_draft text,                       -- For comparison when user edits
    model_used text,
    tokens_used integer,
    processing_time_ms integer,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.draft_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own drafts"
    ON public.draft_replies FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own drafts"
    ON public.draft_replies FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drafts"
    ON public.draft_replies FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own drafts"
    ON public.draft_replies FOR DELETE
    USING (auth.uid() = user_id);

-- 7. Automation rules (user-defined)
CREATE TABLE IF NOT EXISTS public.automation_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    is_enabled boolean DEFAULT true,
    -- Condition: JSON structure for rule matching
    -- Example: { "field": "from_address", "operator": "contains", "value": "@company.com" }
    conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Action: what to do when conditions match
    -- Example: { "type": "auto_reply", "config": { "template": "out_of_office", "confidence_threshold": 0.85 } }
    actions jsonb NOT NULL DEFAULT '[]'::jsonb,
    priority integer DEFAULT 0,
    cooldown_minutes integer DEFAULT 0,        -- Min between firing
    last_fired_at timestamptz,
    fire_count integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own rules"
    ON public.automation_rules FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own rules"
    ON public.automation_rules FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own rules"
    ON public.automation_rules FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own rules"
    ON public.automation_rules FOR DELETE
    USING (auth.uid() = user_id);

-- 8. Audit log (immutable, insert-only via edge functions)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    entity_type text,
    entity_id text,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    ip_address inet,
    user_agent text,
    -- Only edge function can insert via SECURITY DEFINER
    created_at timestamptz DEFAULT now()
);
-- NOTE: RLS will be handled via SECURITY DEFINER edge functions
-- Direct insert from client is blocked
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can SELECT their own audit logs
CREATE POLICY "Users can read own audit logs"
    ON public.audit_logs FOR SELECT
    USING (auth.uid() = user_id);
-- Only service_role can INSERT (enforced via edge function)
CREATE POLICY "Service role can insert audit logs"
    ON public.audit_logs FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_event ON public.audit_logs(user_id, event_type, created_at DESC);

-- 9. Email sync state (for delta sync bookmarks)
CREATE TABLE IF NOT EXISTS public.email_sync_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
    -- Delta token / history ID for incremental sync
    delta_token text,
    sync_cursor text,
    last_full_sync_at timestamptz,
    last_incremental_sync_at timestamptz,
    total_emails_synced integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(account_id)
);
ALTER TABLE public.email_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sync state"
    ON public.email_sync_state FOR SELECT
    USING (auth.uid() = (SELECT user_id FROM public.connected_accounts WHERE id = account_id));

CREATE POLICY "Users can update own sync state"
    ON public.email_sync_state FOR UPDATE
    USING (auth.uid() = (SELECT user_id FROM public.connected_accounts WHERE id = account_id));

-- 10. Email processing queue (for AI background jobs)
CREATE TABLE IF NOT EXISTS public.email_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id uuid NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    task_type text NOT NULL CHECK (task_type IN ('classify', 'summarize', 'embed', 'draft', 'auto_send')),
    priority integer DEFAULT 0,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    error_message text,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz DEFAULT now()
);
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;

-- Queue is processed by edge functions; users shouldn't see it directly
CREATE POLICY "Service role can manage queue"
    ON public.email_queue FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Users can read own queue items"
    ON public.email_queue FOR SELECT
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_email_queue_pending ON public.email_queue(status, created_at) WHERE status = 'pending';

-- 11. User settings / preferences table
CREATE TABLE IF NOT EXISTS public.user_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- Auto-reply settings
    auto_reply_enabled boolean DEFAULT false,
    auto_reply_confidence_threshold float DEFAULT 0.85 CHECK (auto_reply_confidence_threshold >= 0 AND auto_reply_confidence_threshold <= 1),
    auto_reply_window_hours integer DEFAULT 24,
    -- Notification settings
    notify_on_draft boolean DEFAULT true,
    notify_on_urgent boolean DEFAULT true,
    notify_on_error boolean DEFAULT true,
    digest_enabled boolean DEFAULT true,
    digest_schedule text DEFAULT 'daily',    -- 'never', 'daily', 'weekly'
    -- Working hours (UTC)
    working_hours jsonb DEFAULT '{"start": "09:00", "end": "17:00", "timezone": "UTC"}'::jsonb,
    -- AI tone preference (overridable per-reply)
    default_tone text DEFAULT 'professional' CHECK (default_tone IN ('professional', 'friendly', 'formal')),
    -- Feature toggles
    features jsonb DEFAULT '{
        "smart_categorization": true,
        "automated_drafts": true,
        "knowledge_extraction": true,
        "auto_send": false
    }'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id)
);
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own preferences"
    ON public.user_preferences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own preferences"
    ON public.user_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
    ON public.user_preferences FOR UPDATE
    USING (auth.uid() = user_id);

-- Auto-create preferences on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_prefs ON auth.users;
CREATE TRIGGER on_auth_user_created_prefs
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_preferences();
