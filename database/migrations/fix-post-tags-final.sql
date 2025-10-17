-- ============================================
-- FINAL FIX: POST_TAGS - Combine Duplicate Policies
-- ============================================
-- Purpose: Combine 2 SELECT policies and 2 UPDATE policies into 1 each
-- This will eliminate the final 8 Performance Advisor warnings
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing post_tags duplicate policies...';

  -- Drop all existing post_tags policies
  DROP POLICY IF EXISTS post_tags_select_public ON post_tags;
  DROP POLICY IF EXISTS post_tags_select_own ON post_tags;
  DROP POLICY IF EXISTS post_tags_update_creator ON post_tags;
  DROP POLICY IF EXISTS post_tags_update_tagged ON post_tags;
  DROP POLICY IF EXISTS post_tags_insert_policy ON post_tags;
  DROP POLICY IF EXISTS post_tags_delete_policy ON post_tags;

  -- Create SINGLE SELECT policy (combines both public and own)
  CREATE POLICY post_tags_select_policy ON post_tags
  FOR SELECT USING (
    -- Can view active tags on public posts
    (
      status = 'active' AND
      EXISTS (
        SELECT 1 FROM posts
        WHERE posts.id = post_tags.post_id
        AND posts.visibility = 'public'
      )
    )
    OR
    -- Can view tags you created or tags you're in
    (
      (select auth.uid()) = created_by_profile_id OR
      (select auth.uid()) = tagged_profile_id
    )
  );

  -- Create SINGLE UPDATE policy (combines creator and tagged user)
  CREATE POLICY post_tags_update_policy ON post_tags
  FOR UPDATE USING (
    (select auth.uid()) = created_by_profile_id OR
    (select auth.uid()) = tagged_profile_id
  );

  -- Keep other policies as single policies (already correct)
  CREATE POLICY post_tags_insert_policy ON post_tags
  FOR INSERT WITH CHECK (
    (select auth.uid()) = created_by_profile_id AND
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_tags.post_id
      AND posts.profile_id = (select auth.uid())
    )
  );

  CREATE POLICY post_tags_delete_policy ON post_tags
  FOR DELETE USING ((select auth.uid()) = created_by_profile_id);

  RAISE NOTICE '✓ Fixed: post_tags (combined duplicate policies)';
END $$;

SELECT '✓ Post tags fix complete!' AS status;
SELECT 'Refresh Performance Advisor - should now show 0-2 warnings!' AS next_step;
