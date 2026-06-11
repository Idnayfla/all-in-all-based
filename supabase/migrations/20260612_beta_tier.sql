-- Add beta_expires_at for the beta tier
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS beta_expires_at timestamptz;

-- Index for fast expiry lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_beta_expires_at
  ON user_settings (beta_expires_at)
  WHERE beta_expires_at IS NOT NULL;
