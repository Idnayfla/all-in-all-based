-- Store display_name in bans so unban UI can show who was banned after membership is deleted
alter table public.group_bans add column if not exists display_name text;
