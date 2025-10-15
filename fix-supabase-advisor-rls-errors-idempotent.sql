-- ============================================
-- FIX SUPABASE ADVISOR RLS SECURITY ERRORS (IDEMPOTENT)
-- ============================================
-- Purpose: Enable Row Level Security on 3 tables flagged by Supabase Advisor
-- Issues Fixed:
--   1. hockey_game_data - Missing RLS (future sports placeholder)
--   2. volleyball_match_data - Missing RLS (future sports placeholder)
--   3. posts_tags_backup - Missing RLS (old backup table)
-- Severity: ERROR (Security)
-- Version: 2.0 (Idempotent - Safe to run multiple times)
-- Created: 2025-01-15
-- ============================================

-- ============================================
-- SECTION 1: VERIFICATION (BEFORE)
-- ============================================

DO $$
DECLARE
  hockey_rls BOOLEAN;
  volleyball_rls BOOLEAN;
  backup_rls BOOLEAN;
  hockey_exists BOOLEAN;
  volleyball_exists BOOLEAN;
  backup_exists BOOLEAN;
BEGIN
  -- Check if tables exist and their RLS status
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'hockey_game_data') INTO hockey_exists;
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'volleyball_match_data') INTO volleyball_exists;
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'posts_tags_backup') INTO backup_exists;

  IF hockey_exists THEN
    SELECT relrowsecurity INTO hockey_rls FROM pg_class WHERE relname = 'hockey_game_data';
  END IF;

  IF volleyball_exists THEN
    SELECT relrowsecurity INTO volleyball_rls FROM pg_class WHERE relname = 'volleyball_match_data';
  END IF;

  IF backup_exists THEN
    SELECT relrowsecurity INTO backup_rls FROM pg_class WHERE relname = 'posts_tags_backup';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    RLS STATUS CHECK (BEFORE)';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'hockey_game_data: exists=%, RLS=%', hockey_exists, COALESCE(hockey_rls::TEXT, 'N/A');
  RAISE NOTICE 'volleyball_match_data: exists=%, RLS=%', volleyball_exists, COALESCE(volleyball_rls::TEXT, 'N/A');
  RAISE NOTICE 'posts_tags_backup: exists=%, RLS=%', backup_exists, COALESCE(backup_rls::TEXT, 'N/A');
  RAISE NOTICE '';
END $$;

-- ============================================
-- SECTION 2: FIX hockey_game_data TABLE
-- ============================================

-- Enable RLS (if not already enabled)
ALTER TABLE hockey_game_data ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS hockey_data_select_policy ON hockey_game_data;
DROP POLICY IF EXISTS hockey_data_insert_policy ON hockey_game_data;
DROP POLICY IF EXISTS hockey_data_update_policy ON hockey_game_data;
DROP POLICY IF EXISTS hockey_data_delete_policy ON hockey_game_data;

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

-- Add performance index (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_hockey_data_group_post ON hockey_game_data(group_post_id);

-- Add comments
COMMENT ON TABLE hockey_game_data IS 'Hockey-specific data for group posts of type hockey_game (placeholder for future implementation, RLS enabled)';

-- ============================================
-- SECTION 3: FIX volleyball_match_data TABLE
-- ============================================

-- Enable RLS (if not already enabled)
ALTER TABLE volleyball_match_data ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS volleyball_data_select_policy ON volleyball_match_data;
DROP POLICY IF EXISTS volleyball_data_insert_policy ON volleyball_match_data;
DROP POLICY IF EXISTS volleyball_data_update_policy ON volleyball_match_data;
DROP POLICY IF EXISTS volleyball_data_delete_policy ON volleyball_match_data;

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

-- Add performance index (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_volleyball_data_group_post ON volleyball_match_data(group_post_id);

-- Add comments
COMMENT ON TABLE volleyball_match_data IS 'Volleyball-specific data for group posts of type volleyball_match (placeholder for future implementation, RLS enabled)';

-- ============================================
-- SECTION 4: FIX posts_tags_backup TABLE
-- ============================================

DO $$
DECLARE
  backup_count INTEGER;
  backup_exists BOOLEAN;
BEGIN
  -- Check if table exists
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'posts_tags_backup') INTO backup_exists;

  IF NOT backup_exists THEN
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════';
    RAISE NOTICE '    BACKUP TABLE STATUS';
    RAISE NOTICE '═══════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE 'posts_tags_backup: TABLE NOT FOUND';
    RAISE NOTICE 'Skipping backup table processing.';
    RAISE NOTICE '';
    RETURN;
  END IF;

  -- Check if backup table has any data
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
-- Uncomment the line below if you've verified the cleanup was successful:

-- DROP TABLE IF EXISTS posts_tags_backup;

-- OPTION B: Keep the table but enable RLS
-- This is the DEFAULT option (runs automatically)

DO $$
DECLARE
  backup_exists BOOLEAN;
BEGIN
  -- Check if table still exists (may have been dropped above)
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'posts_tags_backup') INTO backup_exists;

  IF backup_exists THEN
    -- Enable RLS on backup table
    ALTER TABLE posts_tags_backup ENABLE ROW LEVEL SECURITY;

    -- Drop existing policy if it exists
    DROP POLICY IF EXISTS backup_select_policy ON posts_tags_backup;

    -- Policy: Only allow SELECT for now (read-only backup)
    CREATE POLICY backup_select_policy ON posts_tags_backup
    FOR SELECT USING (true);

    -- No INSERT/UPDATE/DELETE policies = nobody can modify the backup
    COMMENT ON TABLE posts_tags_backup IS 'BACKUP: Old category tags from posts table (created during cleanup migration, RLS enabled for safety)';

    RAISE NOTICE 'RLS enabled on posts_tags_backup (read-only)';
  END IF;
END $$;

-- ============================================
-- SECTION 5: VERIFICATION (AFTER)
-- ============================================

DO $$
DECLARE
  hockey_rls BOOLEAN;
  volleyball_rls BOOLEAN;
  backup_rls BOOLEAN;
  hockey_policies INTEGER;
  volleyball_policies INTEGER;
  backup_policies INTEGER;
  hockey_exists BOOLEAN;
  volleyball_exists BOOLEAN;
  backup_exists BOOLEAN;
BEGIN
  -- Check if tables exist
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'hockey_game_data') INTO hockey_exists;
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'volleyball_match_data') INTO volleyball_exists;
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'posts_tags_backup') INTO backup_exists;

  -- Check RLS status for existing tables
  IF hockey_exists THEN
    SELECT relrowsecurity INTO hockey_rls FROM pg_class WHERE relname = 'hockey_game_data';
    SELECT COUNT(*) INTO hockey_policies FROM pg_policies WHERE tablename = 'hockey_game_data';
  END IF;

  IF volleyball_exists THEN
    SELECT relrowsecurity INTO volleyball_rls FROM pg_class WHERE relname = 'volleyball_match_data';
    SELECT COUNT(*) INTO volleyball_policies FROM pg_policies WHERE tablename = 'volleyball_match_data';
  END IF;

  IF backup_exists THEN
    SELECT relrowsecurity INTO backup_rls FROM pg_class WHERE relname = 'posts_tags_backup';
    SELECT COUNT(*) INTO backup_policies FROM pg_policies WHERE tablename = 'posts_tags_backup';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    RLS STATUS CHECK (AFTER)';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';

  IF hockey_exists THEN
    RAISE NOTICE 'hockey_game_data:';
    RAISE NOTICE '  RLS Enabled: %', hockey_rls;
    RAISE NOTICE '  Policies: %', hockey_policies;
    RAISE NOTICE '';
  END IF;

  IF volleyball_exists THEN
    RAISE NOTICE 'volleyball_match_data:';
    RAISE NOTICE '  RLS Enabled: %', volleyball_rls;
    RAISE NOTICE '  Policies: %', volleyball_policies;
    RAISE NOTICE '';
  END IF;

  IF backup_exists THEN
    RAISE NOTICE 'posts_tags_backup:';
    RAISE NOTICE '  RLS Enabled: %', backup_rls;
    RAISE NOTICE '  Policies: %', backup_policies;
    RAISE NOTICE '';
  ELSE
    RAISE NOTICE 'posts_tags_backup: TABLE DROPPED OR NOT FOUND';
    RAISE NOTICE '';
  END IF;

  IF (NOT hockey_exists OR hockey_rls) AND
     (NOT volleyball_exists OR volleyball_rls) AND
     (NOT backup_exists OR backup_rls) THEN
    RAISE NOTICE '✓ SUCCESS: All RLS security issues fixed!';
    RAISE NOTICE '✓ Supabase Advisor should now show 0 RLS errors';
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
  cmd
FROM pg_policies
WHERE tablename IN ('hockey_game_data', 'volleyball_match_data', 'posts_tags_backup')
ORDER BY tablename, policyname;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT '✓ RLS security fixes applied successfully!' AS status;
SELECT '✓ This script is idempotent - safe to run multiple times' AS note;
SELECT '✓ Run Supabase Advisor to verify all errors are resolved' AS next_step;
