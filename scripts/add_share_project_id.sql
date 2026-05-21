-- Migration: add project_id + updated_at to shares for stable share URLs
-- Run in Supabase SQL editor

ALTER TABLE shares
  ADD COLUMN IF NOT EXISTS project_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Unique share per user per project (allows upsert)
CREATE UNIQUE INDEX IF NOT EXISTS shares_user_project_idx
  ON shares (user_id, project_id)
  WHERE project_id IS NOT NULL;
