-- api_keys: personal API keys for developers (Pro tier only)
-- Run once in Supabase SQL editor.

create table if not exists api_keys (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'Default',
  key_hash     text not null unique,   -- SHA-256 of the raw key, never store raw
  last_used_at timestamptz,
  revoked_at   timestamptz
);

alter table api_keys enable row level security;

create policy "users manage own keys"
  on api_keys for all
  using (auth.uid() = user_id);

create index if not exists idx_api_keys_user    on api_keys(user_id);
create index if not exists idx_api_keys_hash    on api_keys(key_hash) where revoked_at is null;
