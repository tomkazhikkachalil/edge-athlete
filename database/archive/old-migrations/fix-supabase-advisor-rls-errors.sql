-- ============================================
-- FIX SUPABASE ADVISOR RLS SECURITY ERRORS
-- ============================================
-- Purpose: Enable Row Level Security on 3 tables flagged by Supabase Advisor
-- Issues Fixed:
--   1. hockey_game_data - Missing RLS (future sports placeholder)
--   2. volleyball_match_data - Missing RLS (future sports placeholder)
--   3. posts_tags_backup - Missing RLS (old backup table)
-- Severity: ERROR (Security)
-- Created: 2025-01-15
-- ============================================

-- ============================================
-- SECTION 1: VERIFICATION (BEFORE)
-- ============================================

-- Check current RLS status
DO $$
DECLARE
  hockey_rls BOOLEAN;
  volleyball_rls BOOLEAN;
  backup_rls BOOLEAN;
BEGIN
  SELECT relrowsecurity INTO hockey_rls
  FROM pg_class WHERE relname = 'hockey_game_data';

  SELECT relrowsecurity INTO volleyball_rls
  FROM pg_class WHERE relname = 'volleyball_match_data';

  SELECT relrowsecurity INTO backup_rls
  FROM pg_class WHERE relname = 'posts_tags_backup';

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    RLS STATUS CHECK (BEFORE)';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'hockey_game_data RLS: %', COALESCE(hockey_rls::TEXT, 'TABLE NOT FOUND');
  RAISE NOTICE 'volleyball_match_data RLS: %', COALESCE(volleyball_rls::TEXT, 'TABLE NOT FOUND');
  RAISE NOTICE 'posts_tags_backup RLS: %', COALESCE(backup_rls::TEXT, 'TABLE NOT FOUND');
  RAISE NOTICE '';
END $$;

-- ============================================
-- SECTION 2: FIX hockey_game_data TABLE
-- ============================================

-- Enable RLS
ALTER TABLE hockey_game_data ENABLE ROW LEVEL SECURITY;

-- Policy: View hockey game data if you're the creator or a participant
CREATE POLICY hockey_data_select_policy ON hockey_game_data
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = hockey_game_data.group_post_id
    AND (
      creator_id = auth.uid() OR
      visibility = 'public' OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = hockey_game_data.group_post_id
        AND profile_id = auth.uid()
      )
    )
  )
);

-- Policy: Only creator can add hockey game data
CREATE POLICY hockey_data_insert_policy ON hockey_game_data
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = hockey_game_data.group_post_id
    AND creator_id = auth.uid()
  )
);

-- Policy: Only creator can update hockey game data
CREATE POLICY hockey_data_update_policy ON hockey_game_data
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = hockey_game_data.group_post_id
    AND creator_id = auth.uid()
  )
);

-- Policy: Only creator can delete hockey game data
CREATE POLICY hockey_data_delete_policy ON hockey_game_data
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = hockey_game_data.group_post_id
    AND creator_id = auth.uid()
  )
);

-- Add performance index
CREATE INDEX IF NOT EXISTS idx_hockey_data_group_post ON hockey_game_data(group_post_id);

-- Add comments
COMMENT ON TABLE hockey_game_data IS 'Hockey-specific data for group posts of type hockey_game (placeholder for future implementation, RLS enabled)';

-- ============================================
-- SECTION 3: FIX volleyball_match_data TABLE
-- ============================================

-- Enable RLS
ALTER TABLE volleyball_match_data ENABLE ROW LEVEL SECURITY;

-- Policy: View volleyball match data if you're the creator or a participant
CREATE POLICY volleyball_data_select_policy ON volleyball_match_data
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = volleyball_match_data.group_post_id
    AND (
      creator_id = auth.uid() OR
      visibility = 'public' OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = volleyball_match_data.group_post_id
        AND profile_id = auth.uid()
      )
    )
  )
);

-- Policy: Only creator can add volleyball match data
CREATE POLICY volleyball_data_insert_policy ON volleyball_match_data
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = volleyball_match_data.group_post_id
    AND creator_id = auth.uid()
  )
);

-- Policy: Only creator can update volleyball match data
CREATE POLICY volleyball_data_update_policy ON volleyball_match_data
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = volleyball_match_data.group_post_id
    AND creator_id = auth.uid()
  )
);

-- Policy: Only creator can delete volleyball match data
CREATE POLICY volleyball_data_delete_policy ON volleyball_match_data
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = volleyball_match_data.group_post_id
    AND creator_id = auth.uid()
  )
);

-- Add performance index
CREATE INDEX IF NOT EXISTS idx_volleyball_data_group_post ON volleyball_match_data(group_post_id);

-- Add comments
COMMENT ON TABLE volleyball_match_data IS 'Volleyball-specific data for group posts of type volleyball_match (placeholder for future implementation, RLS enabled)';

-- ============================================
-- SECTION 4: FIX posts_tags_backup TABLE
-- ============================================
-- This table was created during category tags cleanup migration
-- Choose ONE option below:
--   OPTION A (Recommended): Drop the table entirely
--   OPTION B: Keep it but enable RLS

-- Check if backup table has any data
DO $$
DECLARE
  backup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backup_count FROM posts_tags_backup;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    BACKUP TABLE STATUS';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'posts_tags_backup row count: %', backup_count;
  RAISE NOTICE '';

  IF backup_count = 0 THEN
    RAISE NOTICE '✓ Table is empty - safe to drop';
  ELSE
    RAISE NOTICE '⚠ Table contains % backup records', backup_count;
    RAISE NOTICE '  Review data before dropping!';
  END IF;
  RAISE NOTICE '';
END $$;

-- OPTION A (RECOMMENDED): Drop the backup table
-- Uncomment the line below if you've verified the cleanup was successful
-- and no longer need the backup:

-- DROP TABLE IF EXISTS posts_tags_backup;

-- OPTION B: Keep the table but enable RLS
-- Comment out the DROP command above and run this instead:

-- Enable RLS on backup table
ALTER TABLE posts_tags_backup ENABLE ROW LEVEL SECURITY;

-- Policy: Only allow SELECT for now (read-only backup)
CREATE POLICY backup_select_policy ON posts_tags_backup
FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policies = nobody can modify the backup
-- This makes it a read-only archive

COMMENT ON TABLE posts_tags_backup IS 'BACKUP: Old category tags from posts table (created during cleanup migration, RLS enabled for safety)';

-- ============================================
-- SECTION 5: VERIFICATION (AFTER)
-- ============================================

-- Verify RLS is now enabled
DO $$
DECLARE
  hockey_rls BOOLEAN;
  volleyball_rls BOOLEAN;
  backup_rls BOOLEAN;
  hockey_policies INTEGER;
  volleyball_policies INTEGER;
  backup_policies INTEGER;
BEGIN
  -- Check RLS status
  SELECT relrowsecurity INTO hockey_rls
  FROM pg_class WHERE relname = 'hockey_game_data';

  SELECT relrowsecurity INTO volleyball_rls
  FROM pg_class WHERE relname = 'volleyball_match_data';

  SELECT relrowsecurity INTO backup_rls
  FROM pg_class WHERE relname = 'posts_tags_backup';

  -- Count policies
  SELECT COUNT(*) INTO hockey_policies
  FROM pg_policies WHERE tablename = 'hockey_game_data';

  SELECT COUNT(*) INTO volleyball_policies
  FROM pg_policies WHERE tablename = 'volleyball_match_data';

  SELECT COUNT(*) INTO backup_policies
  FROM pg_policies WHERE tablename = 'posts_tags_backup';

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    RLS STATUS CHECK (AFTER)';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'hockey_game_data:';
  RAISE NOTICE '  RLS Enabled: %', COALESCE(hockey_rls::TEXT, 'TABLE NOT FOUND');
  RAISE NOTICE '  Policies: %', hockey_policies;
  RAISE NOTICE '';
  RAISE NOTICE 'volleyball_match_data:';
  RAISE NOTICE '  RLS Enabled: %', COALESCE(volleyball_rls::TEXT, 'TABLE NOT FOUND');
  RAISE NOTICE '  Policies: %', volleyball_policies;
  RAISE NOTICE '';
  RAISE NOTICE 'posts_tags_backup:';
  RAISE NOTICE '  RLS Enabled: %', COALESCE(backup_rls::TEXT, 'TABLE DROPPED OR NOT FOUND');
  RAISE NOTICE '  Policies: %', backup_policies;
  RAISE NOTICE '';

  IF hockey_rls AND volleyball_rls AND (backup_rls OR NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'posts_tags_backup')) THEN
    RAISE NOTICE '✓ SUCCESS: All RLS security issues fixed!';
    RAISE NOTICE '✓ Supabase Advisor should now show 0 errors';
  ELSE
    RAISE NOTICE '⚠ WARNING: Some tables still missing RLS';
  END IF;
  RAISE NOTICE '';
END $$;

-- Show all policies created
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename IN ('hockey_game_data', 'volleyball_match_data', 'posts_tags_backup')
ORDER BY tablename, policyname;

-- ============================================
-- SECTION 6: ROLLBACK (IF NEEDED)
-- ============================================
-- Run these commands if you need to undo the changes
-- (Keep commented - for reference only)

/*
-- Rollback hockey_game_data
DROP POLICY IF EXISTS hockey_data_select_policy ON hockey_game_data;
DROP POLICY IF EXISTS hockey_data_insert_policy ON hockey_game_data;
DROP POLICY IF EXISTS hockey_data_update_policy ON hockey_game_data;
DROP POLICY IF EXISTS hockey_data_delete_policy ON hockey_game_data;
ALTER TABLE hockey_game_data DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_hockey_data_group_post;

-- Rollback volleyball_match_data
DROP POLICY IF EXISTS volleyball_data_select_policy ON volleyball_match_data;
DROP POLICY IF EXISTS volleyball_data_insert_policy ON volleyball_match_data;
DROP POLICY IF EXISTS volleyball_data_update_policy ON volleyball_match_data;
DROP POLICY IF EXISTS volleyball_data_delete_policy ON volleyball_match_data;
ALTER TABLE volleyball_match_data DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_volleyball_data_group_post;

-- Rollback posts_tags_backup
DROP POLICY IF EXISTS backup_select_policy ON posts_tags_backup;
ALTER TABLE posts_tags_backup DISABLE ROW LEVEL SECURITY;
*/

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT '✓ RLS security fixes applied successfully!' AS status;
SELECT '✓ Run Supabase Advisor to verify all errors are resolved' AS next_step;
