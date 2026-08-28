-- ============================================================================
-- 128: 30-day soft delete — park before purge (Family Console Wave 1e)
-- ============================================================================
-- Account deletion used to be immediate and irreversible: one typed-confirm
-- (or one guardian evening) away from destroying a child's entire history.
-- Deletion now PARKS the account for 30 days before the existing hard-delete
-- engine runs:
--
--   * profiles.deletion_requested_at IS NOT NULL  =  parked. The app forces
--     visibility='private' at park time and shows a restore banner (the
--     account owner on sign-in; the guardian on the family console hub).
--   * Restore = clear the stamp. For a supervised child, restore also writes
--     a fresh consent_records 'granted' row (append-only — the park wrote
--     'withdrawn'), so consent returns through admin review.
--   * Purge = a phase in /api/cron/daily calling hardDeleteAccount for rows
--     older than 30 days. No new cron slot (Hobby 2-cron cap).
--
-- The partial index serves both the cron sweep and the guardian roster read.
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_deletion_requested
  ON profiles (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

COMMENT ON COLUMN profiles.deletion_requested_at IS
  'Soft-delete park stamp (migration 128). Non-null = scheduled for hard deletion 30 days after this timestamp; cleared by restore.';
