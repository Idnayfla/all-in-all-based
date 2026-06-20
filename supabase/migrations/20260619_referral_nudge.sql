-- Run in Supabase SQL editor: adds companion_referral_nudged flag to user_settings
alter table public.user_settings
  add column if not exists companion_referral_nudged boolean default false;
