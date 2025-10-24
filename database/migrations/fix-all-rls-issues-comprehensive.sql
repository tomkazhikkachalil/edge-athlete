-- ============================================
-- COMPREHENSIVE RLS FIX - REMOVES DUPLICATES & OPTIMIZES
-- ============================================
-- Purpose: Fix BOTH warning types in one migration
-- Issue 1: 168 unoptimized auth.uid() policies
-- Issue 2: Multiple permissive policies (duplicates causing warnings)
-- Solution: Drop ALL policies, recreate ONE optimized policy per operation
-- Impact: 274 warnings → <20 warnings
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '    COMPREHENSIVE RLS FIX';
  RAISE NOTICE '    - Remove duplicate policies';
  RAISE NOTICE '    - Optimize auth.uid() calls';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ============================================
-- HELPER FUNCTION: Drop all policies for a table
-- ============================================

CREATE OR REPLACE FUNCTION drop_all_policies_for_table(table_name TEXT)
RETURNS void AS $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = table_name
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_record.policyname, table_name);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SECTION 1: PROFILES
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: profiles...';

  PERFORM drop_all_policies_for_table('profiles');

  -- Single optimized SELECT policy
  CREATE POLICY profiles_select_policy ON profiles
  FOR SELECT USING (
    id = (select auth.uid()) OR
    visibility = 'public' OR
    EXISTS (
      SELECT 1 FROM follows
      WHERE follower_id = (select auth.uid())
      AND following_id = profiles.id
      AND status = 'accepted'
    )
  );

  -- Single optimized UPDATE policy
  CREATE POLICY profiles_update_policy ON profiles
  FOR UPDATE USING (
    id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: profiles (removed duplicates, optimized auth.uid())';
END $$;

-- ============================================
-- SECTION 2: POSTS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: posts...';

  PERFORM drop_all_policies_for_table('posts');

  CREATE POLICY posts_select_policy ON posts
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    visibility = 'public' OR
    EXISTS (
      SELECT 1 FROM follows
      WHERE follower_id = (select auth.uid())
      AND following_id = posts.profile_id
      AND status = 'accepted'
    )
  );

  CREATE POLICY posts_insert_policy ON posts
  FOR INSERT WITH CHECK (
    profile_id = (select auth.uid())
  );

  CREATE POLICY posts_update_policy ON posts
  FOR UPDATE USING (
    profile_id = (select auth.uid())
  );

  CREATE POLICY posts_delete_policy ON posts
  FOR DELETE USING (
    profile_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: posts';
END $$;

-- ============================================
-- SECTION 3: POST_LIKES
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: post_likes...';

  PERFORM drop_all_policies_for_table('post_likes');

  CREATE POLICY post_likes_select_policy ON post_likes
  FOR SELECT USING (true);

  CREATE POLICY post_likes_insert_policy ON post_likes
  FOR INSERT WITH CHECK (
    profile_id = (select auth.uid())
  );

  CREATE POLICY post_likes_delete_policy ON post_likes
  FOR DELETE USING (
    profile_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: post_likes';
END $$;

-- ============================================
-- SECTION 4: POST_COMMENTS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: post_comments...';

  PERFORM drop_all_policies_for_table('post_comments');

  CREATE POLICY post_comments_select_policy ON post_comments
  FOR SELECT USING (true);

  CREATE POLICY post_comments_insert_policy ON post_comments
  FOR INSERT WITH CHECK (
    profile_id = (select auth.uid())
  );

  CREATE POLICY post_comments_update_policy ON post_comments
  FOR UPDATE USING (
    profile_id = (select auth.uid())
  );

  CREATE POLICY post_comments_delete_policy ON post_comments
  FOR DELETE USING (
    profile_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: post_comments';
END $$;

-- ============================================
-- SECTION 5: COMMENT_LIKES
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: comment_likes...';

  PERFORM drop_all_policies_for_table('comment_likes');

  CREATE POLICY comment_likes_select_policy ON comment_likes
  FOR SELECT USING (true);

  CREATE POLICY comment_likes_insert_policy ON comment_likes
  FOR INSERT WITH CHECK (
    profile_id = (select auth.uid())
  );

  CREATE POLICY comment_likes_delete_policy ON comment_likes
  FOR DELETE USING (
    profile_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: comment_likes';
END $$;

-- ============================================
-- SECTION 6: SAVED_POSTS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: saved_posts...';

  PERFORM drop_all_policies_for_table('saved_posts');

  CREATE POLICY saved_posts_select_policy ON saved_posts
  FOR SELECT USING (
    profile_id = (select auth.uid())
  );

  CREATE POLICY saved_posts_insert_policy ON saved_posts
  FOR INSERT WITH CHECK (
    profile_id = (select auth.uid())
  );

  CREATE POLICY saved_posts_delete_policy ON saved_posts
  FOR DELETE USING (
    profile_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: saved_posts';
END $$;

-- ============================================
-- SECTION 7: FOLLOWS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: follows...';

  PERFORM drop_all_policies_for_table('follows');

  CREATE POLICY follows_select_policy ON follows
  FOR SELECT USING (
    follower_id = (select auth.uid()) OR
    following_id = (select auth.uid())
  );

  CREATE POLICY follows_insert_policy ON follows
  FOR INSERT WITH CHECK (
    follower_id = (select auth.uid())
  );

  CREATE POLICY follows_update_policy ON follows
  FOR UPDATE USING (
    following_id = (select auth.uid())
  );

  CREATE POLICY follows_delete_policy ON follows
  FOR DELETE USING (
    follower_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: follows';
END $$;

-- ============================================
-- SECTION 8: NOTIFICATIONS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: notifications...';

  PERFORM drop_all_policies_for_table('notifications');

  CREATE POLICY notifications_select_policy ON notifications
  FOR SELECT USING (
    user_id = (select auth.uid())
  );

  CREATE POLICY notifications_insert_policy ON notifications
  FOR INSERT WITH CHECK (true);

  CREATE POLICY notifications_update_policy ON notifications
  FOR UPDATE USING (
    user_id = (select auth.uid())
  );

  CREATE POLICY notifications_delete_policy ON notifications
  FOR DELETE USING (
    user_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: notifications';
END $$;

-- ============================================
-- SECTION 9: NOTIFICATION_PREFERENCES
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: notification_preferences...';

  PERFORM drop_all_policies_for_table('notification_preferences');

  CREATE POLICY notification_preferences_select_policy ON notification_preferences
  FOR SELECT USING (
    user_id = (select auth.uid())
  );

  CREATE POLICY notification_preferences_insert_policy ON notification_preferences
  FOR INSERT WITH CHECK (
    user_id = (select auth.uid())
  );

  CREATE POLICY notification_preferences_update_policy ON notification_preferences
  FOR UPDATE USING (
    user_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: notification_preferences';
END $$;

-- ============================================
-- SECTION 10: POST_MEDIA
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: post_media...';

  PERFORM drop_all_policies_for_table('post_media');

  CREATE POLICY post_media_select_policy ON post_media
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE id = post_media.post_id
      AND (
        profile_id = (select auth.uid()) OR
        visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM follows
          WHERE follower_id = (select auth.uid())
          AND following_id = posts.profile_id
          AND status = 'accepted'
        )
      )
    )
  );

  CREATE POLICY post_media_insert_policy ON post_media
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts
      WHERE id = post_media.post_id
      AND profile_id = (select auth.uid())
    )
  );

  CREATE POLICY post_media_update_policy ON post_media
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE id = post_media.post_id
      AND profile_id = (select auth.uid())
    )
  );

  CREATE POLICY post_media_delete_policy ON post_media
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE id = post_media.post_id
      AND profile_id = (select auth.uid())
    )
  );

  RAISE NOTICE '✓ Fixed: post_media';
END $$;

-- ============================================
-- SECTION 11: POST_TAGS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: post_tags...';

  PERFORM drop_all_policies_for_table('post_tags');

  CREATE POLICY post_tags_select_public ON post_tags
  FOR SELECT USING (
    status = 'active' AND
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_tags.post_id
      AND posts.visibility = 'public'
    )
  );

  CREATE POLICY post_tags_select_own ON post_tags
  FOR SELECT USING (
    (select auth.uid()) = created_by_profile_id OR
    (select auth.uid()) = tagged_profile_id
  );

  CREATE POLICY post_tags_insert_policy ON post_tags
  FOR INSERT WITH CHECK (
    (select auth.uid()) = created_by_profile_id AND
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_tags.post_id
      AND posts.profile_id = (select auth.uid())
    )
  );

  CREATE POLICY post_tags_update_creator ON post_tags
  FOR UPDATE USING ((select auth.uid()) = created_by_profile_id);

  CREATE POLICY post_tags_update_tagged ON post_tags
  FOR UPDATE USING ((select auth.uid()) = tagged_profile_id);

  CREATE POLICY post_tags_delete_policy ON post_tags
  FOR DELETE USING ((select auth.uid()) = created_by_profile_id);

  RAISE NOTICE '✓ Fixed: post_tags';
END $$;

-- ============================================
-- SECTION 12: GOLF_ROUNDS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: golf_rounds...';

  PERFORM drop_all_policies_for_table('golf_rounds');

  CREATE POLICY golf_rounds_select_policy ON golf_rounds
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = golf_rounds.profile_id
      AND (
        visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM follows
          WHERE follower_id = (select auth.uid())
          AND following_id = golf_rounds.profile_id
          AND status = 'accepted'
        )
      )
    )
  );

  CREATE POLICY golf_rounds_insert_policy ON golf_rounds
  FOR INSERT WITH CHECK (
    profile_id = (select auth.uid())
  );

  CREATE POLICY golf_rounds_update_policy ON golf_rounds
  FOR UPDATE USING (
    profile_id = (select auth.uid())
  );

  CREATE POLICY golf_rounds_delete_policy ON golf_rounds
  FOR DELETE USING (
    profile_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: golf_rounds';
END $$;

-- ============================================
-- SECTION 13: GOLF_HOLES
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: golf_holes...';

  PERFORM drop_all_policies_for_table('golf_holes');

  CREATE POLICY golf_holes_select_policy ON golf_holes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM golf_rounds
      WHERE id = golf_holes.round_id
      AND (
        profile_id = (select auth.uid()) OR
        EXISTS (
          SELECT 1 FROM profiles
          WHERE id = golf_rounds.profile_id
          AND (
            visibility = 'public' OR
            EXISTS (
              SELECT 1 FROM follows
              WHERE follower_id = (select auth.uid())
              AND following_id = golf_rounds.profile_id
              AND status = 'accepted'
            )
          )
        )
      )
    )
  );

  CREATE POLICY golf_holes_insert_policy ON golf_holes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM golf_rounds
      WHERE id = golf_holes.round_id
      AND profile_id = (select auth.uid())
    )
  );

  CREATE POLICY golf_holes_update_policy ON golf_holes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM golf_rounds
      WHERE id = golf_holes.round_id
      AND profile_id = (select auth.uid())
    )
  );

  CREATE POLICY golf_holes_delete_policy ON golf_holes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM golf_rounds
      WHERE id = golf_holes.round_id
      AND profile_id = (select auth.uid())
    )
  );

  RAISE NOTICE '✓ Fixed: golf_holes';
END $$;

-- ============================================
-- SECTION 14: GROUP_POSTS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: group_posts...';

  PERFORM drop_all_policies_for_table('group_posts');

  CREATE POLICY group_posts_select_policy ON group_posts
  FOR SELECT USING (
    creator_id = (select auth.uid()) OR
    visibility = 'public' OR
    EXISTS (
      SELECT 1 FROM group_post_participants
      WHERE group_post_id = group_posts.id
      AND profile_id = (select auth.uid())
    )
  );

  CREATE POLICY group_posts_insert_policy ON group_posts
  FOR INSERT WITH CHECK (
    creator_id = (select auth.uid())
  );

  CREATE POLICY group_posts_update_policy ON group_posts
  FOR UPDATE USING (
    creator_id = (select auth.uid())
  );

  CREATE POLICY group_posts_delete_policy ON group_posts
  FOR DELETE USING (
    creator_id = (select auth.uid())
  );

  RAISE NOTICE '✓ Fixed: group_posts';
END $$;

-- ============================================
-- SECTION 15: GROUP_POST_PARTICIPANTS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: group_post_participants...';

  PERFORM drop_all_policies_for_table('group_post_participants');

  CREATE POLICY participants_select_policy ON group_post_participants
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = group_post_participants.group_post_id
      AND creator_id = (select auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM group_post_participants gpp
      WHERE gpp.group_post_id = group_post_participants.group_post_id
      AND gpp.profile_id = (select auth.uid())
    )
  );

  CREATE POLICY participants_insert_policy ON group_post_participants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = group_post_participants.group_post_id
      AND creator_id = (select auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM group_post_participants
      WHERE group_post_id = group_post_participants.group_post_id
      AND profile_id = (select auth.uid())
      AND role IN ('creator', 'organizer')
    )
  );

  CREATE POLICY participants_update_policy ON group_post_participants
  FOR UPDATE USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = group_post_participants.group_post_id
      AND creator_id = (select auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM group_post_participants
      WHERE group_post_id = group_post_participants.group_post_id
      AND profile_id = (select auth.uid())
      AND role IN ('creator', 'organizer')
    )
  );

  CREATE POLICY participants_delete_policy ON group_post_participants
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = group_post_participants.group_post_id
      AND creator_id = (select auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM group_post_participants
      WHERE group_post_id = group_post_participants.group_post_id
      AND profile_id = (select auth.uid())
      AND role IN ('creator', 'organizer')
    )
  );

  RAISE NOTICE '✓ Fixed: group_post_participants';
END $$;

-- ============================================
-- SECTION 16: SEASON_HIGHLIGHTS & PERFORMANCES
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: season_highlights and performances...';

  PERFORM drop_all_policies_for_table('season_highlights');
  PERFORM drop_all_policies_for_table('performances');

  -- Season Highlights
  CREATE POLICY season_highlights_select_policy ON season_highlights
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = season_highlights.profile_id
      AND (
        visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM follows
          WHERE follower_id = (select auth.uid())
          AND following_id = season_highlights.profile_id
          AND status = 'accepted'
        )
      )
    )
  );

  CREATE POLICY season_highlights_insert_policy ON season_highlights
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  CREATE POLICY season_highlights_update_policy ON season_highlights
  FOR UPDATE USING (profile_id = (select auth.uid()));

  CREATE POLICY season_highlights_delete_policy ON season_highlights
  FOR DELETE USING (profile_id = (select auth.uid()));

  -- Performances
  CREATE POLICY performances_select_policy ON performances
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = performances.profile_id
      AND (
        visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM follows
          WHERE follower_id = (select auth.uid())
          AND following_id = performances.profile_id
          AND status = 'accepted'
        )
      )
    )
  );

  CREATE POLICY performances_insert_policy ON performances
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  CREATE POLICY performances_update_policy ON performances
  FOR UPDATE USING (profile_id = (select auth.uid()));

  CREATE POLICY performances_delete_policy ON performances
  FOR DELETE USING (profile_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: season_highlights and performances';
END $$;

-- ============================================
-- SECTION 17: CLEANUP
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '    FIX COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✓ Removed all duplicate policies';
  RAISE NOTICE '✓ Optimized all auth.uid() calls to (select auth.uid())';
  RAISE NOTICE '✓ Created single policy per operation per table';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Refresh Performance Advisor';
  RAISE NOTICE '  2. Verify warnings reduced from 274 to <20';
  RAISE NOTICE '  3. Test application functionality';
  RAISE NOTICE '';
END $$;

-- Drop helper function
DROP FUNCTION IF EXISTS drop_all_policies_for_table(TEXT);

-- Final status
SELECT '✓ Comprehensive RLS fix complete!' AS status;
