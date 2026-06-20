-- Group Chat v2: rolling summary memory + image support
-- Run in Supabase Dashboard → SQL Editor

-- Rolling conversation summary stored per room
alter table public.group_rooms add column if not exists summary text;

-- Image/media URL for messages
alter table public.group_messages add column if not exists media_url text;

-- IMPORTANT: Create a public Storage bucket named "group-media" in
-- Supabase Dashboard → Storage → New bucket → name: group-media → Public: ON
