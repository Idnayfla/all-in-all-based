-- device_heartbeats: one row per (user_id, device_type), upserted on each heartbeat
-- Run once in Supabase SQL editor.

create table if not exists device_heartbeats (
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_type  text not null check (device_type in ('mobile', 'tablet', 'desktop')),
  project_id   text,
  project_name text,
  last_seen    timestamptz not null default now(),
  primary key (user_id, device_type)
);

alter table device_heartbeats enable row level security;

create policy "users manage own heartbeats"
  on device_heartbeats for all
  using (auth.uid() = user_id);
