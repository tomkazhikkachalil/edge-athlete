-- ============================================================================
-- Verify migration 196 (policies baseline) — the live shape is recorded
-- ============================================================================
-- READ ONLY. Safe to run any time. Expected values are the Sep 14 2026
-- catalog's (database/provenance/dumps/2026-09-14-catalog.json); 196 is a no-op on
-- production, so the grid reads the same before and after. A later migration
-- that touches one of these tables changes a number here on purpose.
-- Every row should read OK.
-- ============================================================================

SELECT 'athlete_achievements: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_achievements'
UNION ALL

SELECT 'athlete_achievements: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_achievements'
   AND policyname IN ('athlete_achievements_guardian_write', 'athlete_achievements_profile_access_select')
UNION ALL

SELECT 'athlete_vitals: policies' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_vitals'
UNION ALL

SELECT 'athlete_vitals: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_vitals'
   AND policyname IN ('athlete_vitals_guardian_write', 'athlete_vitals_profile_access_select')
UNION ALL

SELECT 'golf_hole_scores: policies' AS check_name, '7' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores'
UNION ALL

SELECT 'golf_hole_scores: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores'
   AND policyname IN ('golf_hole_scores_delete_policy', 'golf_hole_scores_insert_policy', 'golf_hole_scores_update_policy')
UNION ALL

SELECT 'golf_holes: policies' AS check_name, '5' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_holes'
UNION ALL

SELECT 'golf_holes: recorded present', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_holes'
   AND policyname IN ('golf_holes_delete_policy', 'golf_holes_insert_policy', 'golf_holes_select_policy', 'golf_holes_update_policy')
UNION ALL

SELECT 'golf_participant_scores: policies' AS check_name, '8' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores'
UNION ALL

SELECT 'golf_participant_scores: recorded present', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores'
   AND policyname IN ('golf_participant_scores_insert_policy', 'golf_participant_scores_update_policy', 'participant_scores_insert_policy', 'participant_scores_select_policy', 'participant_scores_update_policy')
UNION ALL

SELECT 'golf_rounds: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds'
UNION ALL

SELECT 'golf_rounds: recorded present', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds'
   AND policyname IN ('golf_rounds_delete_policy', 'golf_rounds_guardian_write', 'golf_rounds_insert_policy', 'golf_rounds_profile_access_select', 'golf_rounds_select_policy', 'golf_rounds_update_policy')
UNION ALL

SELECT 'golf_scorecard_data: policies' AS check_name, '9' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 9 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data'
UNION ALL

SELECT 'golf_scorecard_data: recorded present', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data'
   AND policyname IN ('golf_scorecard_data_insert_policy', 'golf_scorecard_data_select_policy', 'golf_scorecard_data_update_policy', 'scorecard_insert_policy', 'scorecard_select_policy', 'scorecard_update_policy')
UNION ALL

SELECT 'group_post_media: policies' AS check_name, '7' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_post_media'
UNION ALL

SELECT 'group_post_media: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_post_media'
   AND policyname IN ('group_post_media_delete_policy', 'group_post_media_insert_policy', 'group_post_media_select_policy')
UNION ALL

SELECT 'notification_preferences: policies' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_preferences'
UNION ALL

SELECT 'notification_preferences: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_preferences'
   AND policyname IN ('notification_preferences_insert_policy', 'notification_preferences_select_policy', 'notification_preferences_update_policy')
UNION ALL

SELECT 'notifications: policies' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
UNION ALL

SELECT 'notifications: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
   AND policyname IN ('notifications_delete_policy', 'notifications_select_policy', 'notifications_update_policy')
UNION ALL

SELECT 'post_tags: policies' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_tags'
UNION ALL

SELECT 'post_tags: recorded present', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_tags'
   AND policyname IN ('post_tags_delete_policy', 'post_tags_insert_policy', 'post_tags_select_policy', 'post_tags_update_policy')
UNION ALL

SELECT 'profiles: policies' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
UNION ALL

SELECT 'profiles: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
   AND policyname IN ('profiles_select_policy', 'profiles_update_policy')
UNION ALL

SELECT 'saved_posts: policies' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_posts'
UNION ALL

SELECT 'saved_posts: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_posts'
   AND policyname IN ('saved_posts_delete_policy', 'saved_posts_insert_policy', 'saved_posts_select_policy')
UNION ALL

SELECT 'sport_settings: policies' AS check_name, '8' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_settings'
UNION ALL

SELECT 'sport_settings: recorded present', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_settings'
   AND policyname IN ('sport_settings_delete_policy', 'sport_settings_insert_policy', 'sport_settings_select_policy', 'sport_settings_update_policy')
UNION ALL

SELECT 'workout_exercises: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_exercises'
UNION ALL

SELECT 'workout_exercises: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_exercises'
   AND policyname IN ('workout_exercises_guardian_write', 'workout_exercises_profile_access_select')
UNION ALL

SELECT 'workout_sessions: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sessions'
UNION ALL

SELECT 'workout_sessions: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sessions'
   AND policyname IN ('workout_sessions_guardian_write', 'workout_sessions_profile_access_select')
UNION ALL

SELECT 'workout_sets: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sets'
UNION ALL

SELECT 'workout_sets: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sets'
   AND policyname IN ('workout_sets_guardian_write', 'workout_sets_profile_access_select')
UNION ALL

SELECT 'stale claims gone', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public'
   AND (tablename, policyname) IN (('profiles', 'Users can view their own profile'), ('profiles', 'Users can insert their own profile'), ('profiles', 'Users can update their own profile'), ('golf_rounds', 'Users can view their own golf rounds'), ('golf_rounds', 'Users can insert their own golf rounds'), ('golf_rounds', 'Users can update their own golf rounds'), ('golf_rounds', 'Users can delete their own golf rounds'), ('golf_holes', 'Users can view holes for their rounds'), ('golf_holes', 'Users can insert holes for their rounds'), ('golf_holes', 'Users can update holes for their rounds'), ('golf_holes', 'Users can delete holes for their rounds'), ('golf_rounds', 'Users can view golf rounds through posts'), ('golf_holes', 'Users can view holes through posts'), ('notifications', 'Users can view own notifications'), ('notifications', 'Users can update own notifications'), ('notifications', 'System can insert notifications'), ('notifications', 'Users can delete own notifications'), ('notification_preferences', 'Users can view own preferences'), ('notification_preferences', 'Users can update own preferences'), ('notification_preferences', 'Users can insert own preferences'), ('saved_posts', 'Users can view their own saved posts'), ('saved_posts', 'Users can save posts'), ('saved_posts', 'Users can unsave their own posts'), ('post_tags', 'Anyone can view active tags on public posts'), ('post_tags', 'Users can view their own tags'), ('post_tags', 'Users can create tags on their posts'), ('post_tags', 'Users can update their own tags'), ('post_tags', 'Users can delete their own tags'), ('post_tags', 'Tagged users can update their tag status'))
UNION ALL

SELECT 'public policies total', '190', count(*)::text,
       CASE WHEN count(*) = 190 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public'

ORDER BY 1;
