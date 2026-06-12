-- Add Google Calendar OAuth tokens to user_settings.
-- Run this in the Supabase SQL editor.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS google_calendar_tokens jsonb;
