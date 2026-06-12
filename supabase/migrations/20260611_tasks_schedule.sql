-- Smart scheduling fields for timed calendar events
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time TEXT;          -- local HH:MM e.g. "14:00"
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_minutes INTEGER; -- e.g. 60
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tz_offset TEXT;          -- UTC offset e.g. "+08:00"
