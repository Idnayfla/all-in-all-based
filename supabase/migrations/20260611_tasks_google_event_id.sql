-- Add Google Calendar event ID to tasks so we can update/delete synced events
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT;
