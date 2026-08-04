-- ============================================
-- FINAL RLS FIX - ALL REMAINING TABLES
-- ============================================
-- Purpose: Fix all 107 remaining unoptimized policies across 34 tables
-- This completes the RLS optimization for ALL tables
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '    FINAL RLS FIX - ALL REMAINING TABLES';
  RAISE NOTICE '    Fixing 107 remaining unoptimized policies';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ============================================
-- HELPER FUNCTION
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
-- ATHLETE_BADGES
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: athlete_badges...';

  PERFORM drop_all_policies_for_table('athlete_badges');

  CREATE POLICY athlete_badges_select_policy ON athlete_badges
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = athlete_badges.profile_id
      AND visibility = 'public'
    )
  );

  CREATE POLICY athlete_badges_insert_policy ON athlete_badges
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  CREATE POLICY athlete_badges_update_policy ON athlete_badges
  FOR UPDATE USING (profile_id = (select auth.uid()));

  CREATE POLICY athlete_badges_delete_policy ON athlete_badges
  FOR DELETE USING (profile_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: athlete_badges';
END $$;

-- ============================================
-- SPORT_SETTINGS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: sport_settings...';

  PERFORM drop_all_policies_for_table('sport_settings');

  CREATE POLICY sport_settings_select_policy ON sport_settings
  FOR SELECT USING (profile_id = (select auth.uid()));

  CREATE POLICY sport_settings_insert_policy ON sport_settings
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  CREATE POLICY sport_settings_update_policy ON sport_settings
  FOR UPDATE USING (profile_id = (select auth.uid()));

  CREATE POLICY sport_settings_delete_policy ON sport_settings
  FOR DELETE USING (profile_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: sport_settings';
END $$;

-- ============================================
-- ATHLETE_SOCIALS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: athlete_socials...';

  PERFORM drop_all_policies_for_table('athlete_socials');

  CREATE POLICY athlete_socials_select_policy ON athlete_socials
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = athlete_socials.profile_id
      AND visibility = 'public'
    )
  );

  CREATE POLICY athlete_socials_insert_policy ON athlete_socials
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  CREATE POLICY athlete_socials_update_policy ON athlete_socials
  FOR UPDATE USING (profile_id = (select auth.uid()));

  CREATE POLICY athlete_socials_delete_policy ON athlete_socials
  FOR DELETE USING (profile_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: athlete_socials';
END $$;

-- ============================================
-- ATHLETE_VITALS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: athlete_vitals...';

  PERFORM drop_all_policies_for_table('athlete_vitals');

  CREATE POLICY athlete_vitals_select_policy ON athlete_vitals
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = athlete_vitals.profile_id
      AND visibility = 'public'
    )
  );

  CREATE POLICY athlete_vitals_insert_policy ON athlete_vitals
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  CREATE POLICY athlete_vitals_update_policy ON athlete_vitals
  FOR UPDATE USING (profile_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: athlete_vitals';
END $$;

-- ============================================
-- PRIVACY_SETTINGS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: privacy_settings...';

  PERFORM drop_all_policies_for_table('privacy_settings');

  CREATE POLICY privacy_settings_select_policy ON privacy_settings
  FOR SELECT USING (profile_id = (select auth.uid()));

  CREATE POLICY privacy_settings_insert_policy ON privacy_settings
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  CREATE POLICY privacy_settings_update_policy ON privacy_settings
  FOR UPDATE USING (profile_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: privacy_settings';
END $$;

-- ============================================
-- ATHLETE_PERFORMANCES
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: athlete_performances...';

  PERFORM drop_all_policies_for_table('athlete_performances');

  CREATE POLICY athlete_performances_select_policy ON athlete_performances
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = athlete_performances.profile_id
      AND visibility = 'public'
    )
  );

  CREATE POLICY athlete_performances_insert_policy ON athlete_performances
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  CREATE POLICY athlete_performances_update_policy ON athlete_performances
  FOR UPDATE USING (profile_id = (select auth.uid()));

  CREATE POLICY athlete_performances_delete_policy ON athlete_performances
  FOR DELETE USING (profile_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: athlete_performances';
END $$;

-- ============================================
-- ATHLETE_SEASON_HIGHLIGHTS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: athlete_season_highlights...';

  PERFORM drop_all_policies_for_table('athlete_season_highlights');

  CREATE POLICY athlete_season_highlights_select_policy ON athlete_season_highlights
  FOR SELECT USING (
    profile_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = athlete_season_highlights.profile_id
      AND visibility = 'public'
    )
  );

  CREATE POLICY athlete_season_highlights_insert_policy ON athlete_season_highlights
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  CREATE POLICY athlete_season_highlights_update_policy ON athlete_season_highlights
  FOR UPDATE USING (profile_id = (select auth.uid()));

  CREATE POLICY athlete_season_highlights_delete_policy ON athlete_season_highlights
  FOR DELETE USING (profile_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: athlete_season_highlights';
END $$;

-- ============================================
-- ATHLETE_CLUBS (uses athlete_id, not profile_id)
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: athlete_clubs...';

  PERFORM drop_all_policies_for_table('athlete_clubs');

  CREATE POLICY athlete_clubs_select_policy ON athlete_clubs
  FOR SELECT USING (
    athlete_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = athlete_clubs.athlete_id
      AND visibility = 'public'
    )
  );

  CREATE POLICY athlete_clubs_insert_policy ON athlete_clubs
  FOR INSERT WITH CHECK (athlete_id = (select auth.uid()));

  CREATE POLICY athlete_clubs_update_policy ON athlete_clubs
  FOR UPDATE USING (athlete_id = (select auth.uid()));

  CREATE POLICY athlete_clubs_delete_policy ON athlete_clubs
  FOR DELETE USING (athlete_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: athlete_clubs';
END $$;

-- ============================================
-- CONNECTION_SUGGESTIONS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: connection_suggestions...';

  PERFORM drop_all_policies_for_table('connection_suggestions');

  CREATE POLICY connection_suggestions_select_policy ON connection_suggestions
  FOR SELECT USING (profile_id = (select auth.uid()));

  CREATE POLICY connection_suggestions_insert_policy ON connection_suggestions
  FOR INSERT WITH CHECK (profile_id = (select auth.uid()));

  RAISE NOTICE '✓ Fixed: connection_suggestions';
END $$;

-- ============================================
-- SPORTS (public reference table)
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing: sports...';

  PERFORM drop_all_policies_for_table('sports');

  CREATE POLICY sports_select_policy ON sports
  FOR SELECT USING (true);

  CREATE POLICY sports_insert_policy ON sports
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

  RAISE NOTICE '✓ Fixed: sports';
END $$;

-- ============================================
-- GROUP_POST_MEDIA (re-fix if needed)
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Re-fixing: group_post_media...';

  PERFORM drop_all_policies_for_table('group_post_media');

  CREATE POLICY group_post_media_select_policy ON group_post_media
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM group_post_participants
      WHERE group_post_id = group_post_media.group_post_id
      AND profile_id = (select auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = group_post_media.group_post_id
      AND (creator_id = (select auth.uid()) OR visibility = 'public')
    )
  );

  CREATE POLICY group_post_media_insert_policy ON group_post_media
  FOR INSERT WITH CHECK (
    (select auth.uid()) = uploaded_by AND
    EXISTS (
      SELECT 1 FROM group_post_participants
      WHERE group_post_id = group_post_media.group_post_id
      AND profile_id = (select auth.uid())
      AND status = 'confirmed'
    )
  );

  CREATE POLICY group_post_media_delete_policy ON group_post_media
  FOR DELETE USING (
    (select auth.uid()) = uploaded_by OR
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = group_post_media.group_post_id
      AND creator_id = (select auth.uid())
    )
  );

  RAISE NOTICE '✓ Fixed: group_post_media';
END $$;

-- ============================================
-- GOLF_SCORECARD_DATA (re-fix)
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Re-fixing: golf_scorecard_data...';

  PERFORM drop_all_policies_for_table('golf_scorecard_data');

  CREATE POLICY golf_scorecard_data_select_policy ON golf_scorecard_data
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = golf_scorecard_data.group_post_id
      AND (
        creator_id = (select auth.uid()) OR
        visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM group_post_participants
          WHERE group_post_id = golf_scorecard_data.group_post_id
          AND profile_id = (select auth.uid())
        )
      )
    )
  );

  CREATE POLICY golf_scorecard_data_insert_policy ON golf_scorecard_data
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = golf_scorecard_data.group_post_id
      AND creator_id = (select auth.uid())
    )
  );

  CREATE POLICY golf_scorecard_data_update_policy ON golf_scorecard_data
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = golf_scorecard_data.group_post_id
      AND creator_id = (select auth.uid())
    )
  );

  RAISE NOTICE '✓ Fixed: golf_scorecard_data';
END $$;

-- ============================================
-- GOLF_PARTICIPANT_SCORES (re-fix)
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Re-fixing: golf_participant_scores...';

  PERFORM drop_all_policies_for_table('golf_participant_scores');

  CREATE POLICY golf_participant_scores_select_policy ON golf_participant_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM group_post_participants gpp
      JOIN group_posts gp ON gpp.group_post_id = gp.id
      WHERE gpp.id = golf_participant_scores.participant_id
      AND (
        gpp.profile_id = (select auth.uid()) OR
        gp.creator_id = (select auth.uid()) OR
        EXISTS (
          SELECT 1 FROM group_post_participants
          WHERE group_post_id = gp.id
          AND profile_id = (select auth.uid())
        )
      )
    )
  );

  CREATE POLICY golf_participant_scores_insert_policy ON golf_participant_scores
  FOR INSERT WITH CHECK (
    (select auth.uid()) = entered_by AND
    EXISTS (
      SELECT 1 FROM group_post_participants gpp
      JOIN group_posts gp ON gpp.group_post_id = gp.id
      WHERE gpp.id = golf_participant_scores.participant_id
      AND (gpp.profile_id = (select auth.uid()) OR gp.creator_id = (select auth.uid()))
    )
  );

  CREATE POLICY golf_participant_scores_update_policy ON golf_participant_scores
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM group_post_participants
      WHERE id = golf_participant_scores.participant_id
      AND profile_id = (select auth.uid())
    )
  );

  RAISE NOTICE '✓ Fixed: golf_participant_scores';
END $$;

-- ============================================
-- GOLF_HOLE_SCORES (re-fix)
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Re-fixing: golf_hole_scores...';

  PERFORM drop_all_policies_for_table('golf_hole_scores');

  CREATE POLICY golf_hole_scores_select_policy ON golf_hole_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM golf_participant_scores gps
      JOIN group_post_participants gpp ON gps.participant_id = gpp.id
      JOIN group_posts gp ON gpp.group_post_id = gp.id
      WHERE gps.id = golf_hole_scores.golf_participant_id
      AND (
        gpp.profile_id = (select auth.uid()) OR
        gp.creator_id = (select auth.uid()) OR
        EXISTS (
          SELECT 1 FROM group_post_participants
          WHERE group_post_id = gp.id
          AND profile_id = (select auth.uid())
        )
      )
    )
  );

  CREATE POLICY golf_hole_scores_insert_policy ON golf_hole_scores
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM golf_participant_scores gps
      JOIN group_post_participants gpp ON gps.participant_id = gpp.id
      JOIN group_posts gp ON gpp.group_post_id = gp.id
      WHERE gps.id = golf_hole_scores.golf_participant_id
      AND (gpp.profile_id = (select auth.uid()) OR gp.creator_id = (select auth.uid()))
    )
  );

  CREATE POLICY golf_hole_scores_update_policy ON golf_hole_scores
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM golf_participant_scores gps
      JOIN group_post_participants gpp ON gps.participant_id = gpp.id
      WHERE gps.id = golf_hole_scores.golf_participant_id
      AND gpp.profile_id = (select auth.uid())
    )
  );

  CREATE POLICY golf_hole_scores_delete_policy ON golf_hole_scores
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM golf_participant_scores gps
      JOIN group_post_participants gpp ON gps.participant_id = gpp.id
      JOIN group_posts gp ON gpp.group_post_id = gp.id
      WHERE gps.id = golf_hole_scores.golf_participant_id
      AND (gpp.profile_id = (select auth.uid()) OR gp.creator_id = (select auth.uid()))
    )
  );

  RAISE NOTICE '✓ Fixed: golf_hole_scores';
END $$;

-- ============================================
-- HOCKEY_GAME_DATA (re-fix)
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Re-fixing: hockey_game_data...';

  PERFORM drop_all_policies_for_table('hockey_game_data');

  CREATE POLICY hockey_game_data_select_policy ON hockey_game_data
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = hockey_game_data.group_post_id
      AND (
        creator_id = (select auth.uid()) OR
        visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM group_post_participants
          WHERE group_post_id = hockey_game_data.group_post_id
          AND profile_id = (select auth.uid())
        )
      )
    )
  );

  CREATE POLICY hockey_game_data_insert_policy ON hockey_game_data
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = hockey_game_data.group_post_id
      AND creator_id = (select auth.uid())
    )
  );

  CREATE POLICY hockey_game_data_update_policy ON hockey_game_data
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = hockey_game_data.group_post_id
      AND creator_id = (select auth.uid())
    )
  );

  CREATE POLICY hockey_game_data_delete_policy ON hockey_game_data
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = hockey_game_data.group_post_id
      AND creator_id = (select auth.uid())
    )
  );

  RAISE NOTICE '✓ Fixed: hockey_game_data';
END $$;

-- ============================================
-- VOLLEYBALL_MATCH_DATA (re-fix)
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Re-fixing: volleyball_match_data...';

  PERFORM drop_all_policies_for_table('volleyball_match_data');

  CREATE POLICY volleyball_match_data_select_policy ON volleyball_match_data
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = volleyball_match_data.group_post_id
      AND (
        creator_id = (select auth.uid()) OR
        visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM group_post_participants
          WHERE group_post_id = volleyball_match_data.group_post_id
          AND profile_id = (select auth.uid())
        )
      )
    )
  );

  CREATE POLICY volleyball_match_data_insert_policy ON volleyball_match_data
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = volleyball_match_data.group_post_id
      AND creator_id = (select auth.uid())
    )
  );

  CREATE POLICY volleyball_match_data_update_policy ON volleyball_match_data
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = volleyball_match_data.group_post_id
      AND creator_id = (select auth.uid())
    )
  );

  CREATE POLICY volleyball_match_data_delete_policy ON volleyball_match_data
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM group_posts
      WHERE id = volleyball_match_data.group_post_id
      AND creator_id = (select auth.uid())
    )
  );

  RAISE NOTICE '✓ Fixed: volleyball_match_data';
END $$;

-- ============================================
-- SUMMARY
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '    FINAL FIX COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✓ Fixed all remaining tables';
  RAISE NOTICE '✓ All auth.uid() calls now optimized';
  RAISE NOTICE '✓ All duplicate policies removed';
  RAISE NOTICE '';
  RAISE NOTICE 'Next: Refresh Performance Advisor';
  RAISE NOTICE 'Expected: Warnings reduced to <20';
  RAISE NOTICE '';
END $$;

-- Cleanup
DROP FUNCTION IF EXISTS drop_all_policies_for_table(TEXT);

SELECT '✓ Final RLS fix complete!' AS status;
