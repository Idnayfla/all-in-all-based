-- Ban tracking for group rooms
create table if not exists public.group_bans (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.group_rooms(id) on delete cascade not null,
  user_id uuid not null,
  banned_by uuid not null,
  created_at timestamptz default now() not null,
  unique(room_id, user_id)
);
alter table public.group_bans enable row level security;
