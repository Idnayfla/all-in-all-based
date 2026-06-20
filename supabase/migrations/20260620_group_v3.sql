-- Group Chat v3: file attachments + filename storage
-- Run in Supabase Dashboard → SQL Editor

alter table public.group_messages add column if not exists media_filename text;

