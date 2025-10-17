-- ============================================
-- CORRECTIVE FIX: Add Missing Foreign Key Indexes
-- ============================================
-- Purpose: Add back foreign key indexes that were incorrectly dropped
-- Context: Previous cleanup was too aggressive - some "unused" indexes
--          were actually covering foreign keys and are needed for JOINs
-- Impact: Fixes 9 unindexed foreign key warnings
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '    CORRECTIVE FIX: Missing Foreign Key Indexes';
  RAISE NOTICE '    Adding 9 indexes to cover foreign keys';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ============================================
-- ADD MISSING FOREIGN KEY INDEXES
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Adding foreign key indexes...';

  -- athlete_clubs.club_id
  CREATE INDEX IF NOT EXISTS idx_athlete_clubs_club_id
  ON athlete_clubs(club_id);

  -- golf_rounds.profile_id
  CREATE INDEX IF NOT EXISTS idx_golf_rounds_profile_id
  ON golf_rounds(profile_id);

  -- group_post_media.group_post_id
  CREATE INDEX IF NOT EXISTS idx_group_post_media_group_post_id
  ON group_post_media(group_post_id);

  -- notifications.actor_id
  CREATE INDEX IF NOT EXISTS idx_notifications_actor_id
  ON notifications(actor_id);

  -- notifications.user_id
  CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications(user_id);

  -- performances.profile_id
  CREATE INDEX IF NOT EXISTS idx_performances_profile_id
  ON performances(profile_id);

  -- post_comments.parent_comment_id
  CREATE INDEX IF NOT EXISTS idx_post_comments_parent_comment_id
  ON post_comments(parent_comment_id);

  -- post_comments.profile_id
  CREATE INDEX IF NOT EXISTS idx_post_comments_profile_id
  ON post_comments(profile_id);

  -- post_likes.profile_id
  CREATE INDEX IF NOT EXISTS idx_post_likes_profile_id
  ON post_likes(profile_id);

  RAISE NOTICE '✓ Added 9 foreign key indexes';
END $$;

-- ============================================
-- VERIFICATION
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '    CORRECTIVE FIX COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✓ Added 9 missing foreign key indexes';
  RAISE NOTICE '';
  RAISE NOTICE 'Expected Results:';
  RAISE NOTICE '  - Unindexed foreign key warnings: 0';
  RAISE NOTICE '  - The 3 "unused index" warnings are normal';
  RAISE NOTICE '    (indexes just created, will be used soon)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Refresh Performance Advisor';
  RAISE NOTICE '  2. Verify unindexed FK warnings are gone';
  RAISE NOTICE '  3. Unused index warnings will disappear after queries run';
  RAISE NOTICE '';
END $$;

SELECT '✓ Foreign key indexes restored!' AS status;

-- ============================================
-- NOTES
-- ============================================
--
-- Why This Was Needed:
-- The previous cleanup migration dropped indexes that appeared "unused"
-- but were actually covering foreign keys. These indexes are critical
-- for JOIN performance even if the query planner hasn't used them yet.
--
-- About "Unused Index" Warnings:
-- The 3 indexes we added earlier (connection_suggestions, notifications)
-- show as "unused" because they're brand new. Once the database runs
-- queries that use those foreign keys, they'll be marked as "used".
-- This is normal and expected behavior.
--
-- Performance Impact:
-- - Before: Missing FK indexes cause slow JOINs
-- - After: All foreign keys properly indexed for fast JOINs
-- ============================================
