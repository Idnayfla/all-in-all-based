-- Migration: add gallery columns to shares so projects can be published to the
-- public gallery (getbased.dev/gallery). Without these columns the gallery POST
-- update silently fails and the gallery GET (.eq('in_gallery', true)) returns
-- nothing — shared projects never appear.
-- Run in Supabase SQL editor.

ALTER TABLE shares
  ADD COLUMN IF NOT EXISTS in_gallery BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gallery_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS author_name TEXT,
  ADD COLUMN IF NOT EXISTS remix_count INTEGER NOT NULL DEFAULT 0;

-- Fast lookups for the gallery feed (published, sorted by popularity/recency).
CREATE INDEX IF NOT EXISTS shares_gallery_idx
  ON shares (in_gallery, remix_count DESC, gallery_published_at DESC)
  WHERE in_gallery = true;
