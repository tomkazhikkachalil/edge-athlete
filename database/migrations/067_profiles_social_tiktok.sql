-- ============================================================================
-- Migration 067 — profiles.social_tiktok (TikTok connection)
-- ============================================================================
-- WHAT: one nullable TEXT column holding the athlete's TikTok handle,
-- joining social_twitter / social_instagram / social_facebook (which date
-- from the pre-numbering era; this is the first social column added since).
-- Stored as typed (handle, with or without a leading @) — display strips
-- the @ and links to https://www.tiktok.com/@{handle}.
--
-- ⚠️ ORDER OF OPERATIONS: RUN THIS BEFORE DEPLOYING the PR that ships it.
-- GET /api/public/profile selects the column explicitly → 42703 without it.
-- Running early breaks nothing (no reader references it until the deploy).
--
-- PRE-FLIGHT (expect: 0 rows — column absent):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name = 'social_tiktok';
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS social_tiktok TEXT;

COMMENT ON COLUMN profiles.social_tiktok IS
  'TikTok handle (raw as typed; display strips @ and links to tiktok.com/@handle)';

-- VERIFY (expect: one row, data_type text):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name = 'social_tiktok';
