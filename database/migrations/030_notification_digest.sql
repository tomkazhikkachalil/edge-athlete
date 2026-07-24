-- ============================================================================
-- Migration 030 — notification_preferences.last_digest_at (email digests)
-- ============================================================================
-- The daily digest cron emails opted-in users (email_enabled = true) a summary
-- of notifications created since their last digest. This column tracks that
-- watermark so the same notification is never emailed twice.
--
-- email_enabled already exists (migration 003, default false — opt-in).
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS last_digest_at TIMESTAMPTZ;

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'notification_preferences' AND column_name = 'last_digest_at';
--   → one row
