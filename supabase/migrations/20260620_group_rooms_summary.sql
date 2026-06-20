-- Rolling conversation summary for Based's long-term memory in group chats
alter table public.group_rooms add column if not exists summary text;
