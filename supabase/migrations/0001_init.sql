-- AINBOX-4: Initial schema (RLS + pgvector + audit)
-- PRD anchors: §4.1 (tenant isolation), §4.2 (OAuth token storage),
--              §4.3 (email content handling), §6.1 (data inventory)
--
-- Every table has:
--   * user_id uuid not null references auth.users(id) on delete cascade
--   * row-level security enabled
--   * RLS policy: auth.uid() = user_id (read + write)
--
-- No service-role bypass in user-facing edge functions (PRD §4.1).

------------------------------------------------------------------
-- Extensions
------------------------------------------------------------------

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "vector";     -- pgvector (1024-dim, bge-m3)

------------------------------------------------------------------
-- 1. oauth_tokens (PRD §4.2)
--    Refresh tokens encrypted at column level. Access tokens
--    minted from refresh tokens at request time but cached briefly
--    here with TTL via expires_at.
------------------------------------------------------------------

create table if not exists public.oauth_tokens (
  user_id                  uuid        not null references auth.users(id) on delete cascade,
  provider                 text        not null check (provider in ('gmail', 'outlook')),
  encrypted_refresh_token  text        not null,
  access_token_encrypted   text,
  expires_at               timestamptz,
  scope                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.oauth_tokens enable row level security;

create policy "oauth_tokens_owner_select" on public.oauth_tokens
  for select using (auth.uid() = user_id);
create policy "oauth_tokens_owner_insert" on public.oauth_tokens
  for insert with check (auth.uid() = user_id);
create policy "oauth_tokens_owner_update" on public.oauth_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "oauth_tokens_owner_delete" on public.oauth_tokens
  for delete using (auth.uid() = user_id);

------------------------------------------------------------------
-- 2. email_messages (PRD §4.3, §6.1)
--    Bodies stored encrypted (bytea). IV stored alongside.
--    subject_hash is sha256 of subject — never raw subject.
------------------------------------------------------------------

create table if not exists public.email_messages (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users(id) on delete cascade,
  provider             text        not null check (provider in ('gmail', 'outlook')),
  external_message_id  text        not null,
  thread_id            text,
  sender_email         text,
  subject_hash         text,
  body_encrypted       bytea,
  body_iv              bytea,
  length_chars         integer,
  received_at          timestamptz,
  category             text,
  classified_at        timestamptz,
  confidence           numeric(3,2),
  is_outbound          boolean     not null default false,
  unique (user_id, provider, external_message_id)
);

create index if not exists email_messages_user_received_idx
  on public.email_messages (user_id, received_at desc);
create index if not exists email_messages_user_thread_idx
  on public.email_messages (user_id, thread_id);
create index if not exists email_messages_user_category_idx
  on public.email_messages (user_id, category);

alter table public.email_messages enable row level security;

create policy "email_messages_owner_select" on public.email_messages
  for select using (auth.uid() = user_id);
create policy "email_messages_owner_insert" on public.email_messages
  for insert with check (auth.uid() = user_id);
create policy "email_messages_owner_update" on public.email_messages
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "email_messages_owner_delete" on public.email_messages
  for delete using (auth.uid() = user_id);

------------------------------------------------------------------
-- 3. email_sync_state
--    delta_token (Outlook) / history_id (Gmail) per provider.
------------------------------------------------------------------

create table if not exists public.email_sync_state (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  provider         text        not null check (provider in ('gmail', 'outlook')),
  delta_token      text,
  history_id       text,
  last_synced_at   timestamptz,
  primary key (user_id, provider)
);

alter table public.email_sync_state enable row level security;

create policy "email_sync_state_owner_select" on public.email_sync_state
  for select using (auth.uid() = user_id);
create policy "email_sync_state_owner_insert" on public.email_sync_state
  for insert with check (auth.uid() = user_id);
create policy "email_sync_state_owner_update" on public.email_sync_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "email_sync_state_owner_delete" on public.email_sync_state
  for delete using (auth.uid() = user_id);

------------------------------------------------------------------
-- 4. kb_items
--    Vector dim locked at 1024 (Ollama bge-m3). Switching model
--    requires a migration + corpus re-embed.
------------------------------------------------------------------

create table if not exists public.kb_items (
  id                uuid          primary key default gen_random_uuid(),
  user_id           uuid          not null references auth.users(id) on delete cascade,
  type              text          not null check (type in ('faq','policy','pricing','preference','contact','signature','tone-sample')),
  content           text          not null,
  source_email_id   uuid          references public.email_messages(id) on delete set null,
  confidence        numeric(3,2),
  human_verified    boolean       not null default false,
  embedding         vector(1024),
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

create index if not exists kb_items_user_type_idx
  on public.kb_items (user_id, type);
-- IVFFlat index on the embedding for ANN search; lists tunable later.
create index if not exists kb_items_embedding_idx
  on public.kb_items using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.kb_items enable row level security;

create policy "kb_items_owner_select" on public.kb_items
  for select using (auth.uid() = user_id);
create policy "kb_items_owner_insert" on public.kb_items
  for insert with check (auth.uid() = user_id);
create policy "kb_items_owner_update" on public.kb_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "kb_items_owner_delete" on public.kb_items
  for delete using (auth.uid() = user_id);

------------------------------------------------------------------
-- 5. drafts
------------------------------------------------------------------

create table if not exists public.drafts (
  id                  uuid          primary key default gen_random_uuid(),
  user_id             uuid          not null references auth.users(id) on delete cascade,
  in_reply_to         uuid          references public.email_messages(id) on delete set null,
  body                text          not null,
  confidence          numeric(3,2),
  category            text,
  status              text          not null check (status in ('pending','approved','sent','rejected')),
  provider_draft_id   text,
  scheduled_send_at   timestamptz,
  created_at          timestamptz   not null default now(),
  sent_at             timestamptz
);

create index if not exists drafts_user_status_idx
  on public.drafts (user_id, status);
create index if not exists drafts_user_created_idx
  on public.drafts (user_id, created_at desc);

alter table public.drafts enable row level security;

create policy "drafts_owner_select" on public.drafts
  for select using (auth.uid() = user_id);
create policy "drafts_owner_insert" on public.drafts
  for insert with check (auth.uid() = user_id);
create policy "drafts_owner_update" on public.drafts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "drafts_owner_delete" on public.drafts
  for delete using (auth.uid() = user_id);

------------------------------------------------------------------
-- 6. automation_config
--    Threshold MUST be >= 0.85 (PRD §4.4 / mission anti-pattern §9.2).
--    User can raise but never lower below 0.85.
------------------------------------------------------------------

create table if not exists public.automation_config (
  user_id     uuid          primary key references auth.users(id) on delete cascade,
  category    text,
  auto_send   boolean       not null default false,
  threshold   numeric(3,2)  not null default 0.85 check (threshold >= 0.85),
  updated_at  timestamptz   not null default now()
);

alter table public.automation_config enable row level security;

create policy "automation_config_owner_select" on public.automation_config
  for select using (auth.uid() = user_id);
create policy "automation_config_owner_insert" on public.automation_config
  for insert with check (auth.uid() = user_id);
create policy "automation_config_owner_update" on public.automation_config
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "automation_config_owner_delete" on public.automation_config
  for delete using (auth.uid() = user_id);

------------------------------------------------------------------
-- 7. audit_log (PRD §6.1, §6.2)
--    No body content here — only decision events with metadata.
------------------------------------------------------------------

create table if not exists public.audit_log (
  id              uuid          primary key default gen_random_uuid(),
  user_id         uuid          not null references auth.users(id) on delete cascade,
  event_type      text          not null,
  target_id       uuid,
  model           text,
  confidence      numeric(3,2),
  kb_items_used   uuid[],
  details_json    jsonb,
  created_at      timestamptz   not null default now()
);

create index if not exists audit_log_user_created_idx
  on public.audit_log (user_id, created_at desc);
create index if not exists audit_log_user_event_idx
  on public.audit_log (user_id, event_type);

alter table public.audit_log enable row level security;

create policy "audit_log_owner_select" on public.audit_log
  for select using (auth.uid() = user_id);
create policy "audit_log_owner_insert" on public.audit_log
  for insert with check (auth.uid() = user_id);
-- audit_log is append-only at the user level: no update / delete policies.

------------------------------------------------------------------
-- updated_at triggers
------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger oauth_tokens_set_updated_at
  before update on public.oauth_tokens
  for each row execute function public.set_updated_at();

create trigger kb_items_set_updated_at
  before update on public.kb_items
  for each row execute function public.set_updated_at();

create trigger automation_config_set_updated_at
  before update on public.automation_config
  for each row execute function public.set_updated_at();
