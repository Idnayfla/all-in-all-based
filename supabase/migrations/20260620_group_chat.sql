-- Group Chat Phase 1: Observer + @mention
-- Run in Supabase Dashboard → SQL Editor

create table if not exists public.group_rooms (
  id uuid default gen_random_uuid() primary key,
  name text not null default 'Group Chat',
  code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now() not null
);

create table if not exists public.group_members (
  room_id uuid not null references public.group_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz default now() not null,
  primary key (room_id, user_id)
);

create table if not exists public.group_messages (
  id uuid default gen_random_uuid() primary key,
  room_id uuid not null references public.group_rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  content text not null,
  is_based boolean default false not null,
  created_at timestamptz default now() not null
);

create index if not exists group_messages_room_id_idx on public.group_messages(room_id, created_at);

-- RLS
alter table public.group_rooms enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;

-- group_rooms: members can read their rooms
create policy "members can read rooms" on public.group_rooms
  for select using (
    exists (select 1 from public.group_members where room_id = id and user_id = auth.uid())
    or created_by = auth.uid()
  );

create policy "authenticated users can create rooms" on public.group_rooms
  for insert with check (auth.uid() = created_by);

-- group_members: members can see who else is in their rooms
create policy "members can read members" on public.group_members
  for select using (
    exists (select 1 from public.group_members m2 where m2.room_id = room_id and m2.user_id = auth.uid())
  );

create policy "authenticated users can join rooms" on public.group_members
  for insert with check (auth.uid() = user_id);

-- group_messages: members can read and insert
create policy "members can read messages" on public.group_messages
  for select using (
    exists (select 1 from public.group_members where room_id = group_messages.room_id and user_id = auth.uid())
  );

create policy "members can send messages" on public.group_messages
  for insert with check (
    exists (select 1 from public.group_members where room_id = group_messages.room_id and user_id = auth.uid())
    or user_id is null -- Based responses inserted server-side via supabaseAdmin
  );

-- Enable realtime for messages
alter publication supabase_realtime add table public.group_messages;

