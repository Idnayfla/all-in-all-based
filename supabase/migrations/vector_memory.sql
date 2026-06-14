-- Vector memory for Based companion
-- Run this once in Supabase Dashboard → SQL Editor

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Create the memory_vectors table
create table if not exists memory_vectors (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  content     text        not null,
  embedding   vector(768),           -- Gemini text-embedding-004 dimensions
  source      text        default 'conversation',
  created_at  timestamptz default now() not null,
  session_at  timestamptz
);

-- 3. HNSW index for fast cosine similarity search (works well even with few rows)
create index if not exists memory_vectors_embedding_idx
  on memory_vectors using hnsw (embedding vector_cosine_ops);

-- 4. Index for per-user filtering
create index if not exists memory_vectors_user_idx
  on memory_vectors (user_id);

-- 5. Similarity search function used by lib/vectorMemory.ts
create or replace function match_memories(
  query_embedding  vector(768),
  match_user_id    uuid,
  match_count      int     default 4,
  match_threshold  float   default 0.72
)
returns table (content text, similarity float)
language sql stable
as $$
  select
    content,
    1 - (embedding <=> query_embedding) as similarity
  from memory_vectors
  where user_id = match_user_id
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- 6. RLS: users can only read/write their own memories
alter table memory_vectors enable row level security;

create policy "Users can manage their own memories"
  on memory_vectors
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
