-- PRD §3.7 Embeddings (Ollama bge-m3, 1024-dim)
-- PRD §4.1 Tenant isolation (RLS)
-- PRD §7.8 Embedding pipeline — re-embed on edit + search RPC
--
-- This migration depends on the AINBOX-4 schema (`0001_*.sql`) which
-- creates `kb_items` with at minimum:
--   id          uuid pk
--   user_id     uuid not null references auth.users(id)
--   type        text not null
--   content     text not null
--   embedding   vector(1024)
--   source_id   text/uuid (chunk grouping)
--   chunk_index int
--   updated_at  timestamptz default now()
--
-- We do NOT redefine those columns here. We only:
--   1. ensure pgvector ext is present
--   2. add a trigger that nulls the embedding when content changes
--      (so a worker re-embeds the row)
--   3. create the cosine-similarity RPC `match_kb_items` used by the
--      search route. The RPC is SECURITY INVOKER — RLS still applies.
--
-- Re-running this migration is safe (IF NOT EXISTS / OR REPLACE).

create extension if not exists vector;

-- Trigger: when kb_items.content is changed by an UPDATE, clear the
-- embedding so the embedding worker knows to re-embed it. Insertions
-- are not affected (the indexer sets the embedding directly).
create or replace function public.kb_items_clear_embedding_on_content_change()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'UPDATE') and (new.content is distinct from old.content) then
    new.embedding := null;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kb_items_reembed on public.kb_items;
create trigger trg_kb_items_reembed
before update on public.kb_items
for each row
execute function public.kb_items_clear_embedding_on_content_change();

-- Cosine-similarity match RPC. SECURITY INVOKER (default) means RLS on
-- kb_items is enforced; callers only ever see their own rows.
create or replace function public.match_kb_items(
  query_embedding vector(1024),
  match_count int default 5
)
returns table (
  id uuid,
  type text,
  content text,
  source_id text,
  chunk_index int,
  similarity float
)
language sql
stable
as $$
  select
    kb.id,
    kb.type,
    kb.content,
    kb.source_id::text,
    kb.chunk_index,
    1 - (kb.embedding <=> query_embedding) as similarity
  from public.kb_items kb
  where kb.embedding is not null
  order by kb.embedding <=> query_embedding
  limit greatest(1, least(50, match_count));
$$;

grant execute on function public.match_kb_items(vector, int) to authenticated;
