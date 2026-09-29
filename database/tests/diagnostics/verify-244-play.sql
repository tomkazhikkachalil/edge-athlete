-- ============================================================================
-- Verify migration 244 (play: the performance fact table's shared context;
-- badge_awards, athlete_rivalry_display, challenges, live_cheers; the
-- challenge bells; challenges_enabled; reserved 'r')
-- ============================================================================
-- READ ONLY, runnable before 244 (the structural rows read CHECK FAILED) and
-- after (every row OK; INFO rows are counts to read, never failures). The
-- migration ends in ONE result row ("244 APPLIED | 3 | 4 | 4 | 1 | 1 | 1 | 244").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-244-play.sql' AS expected, 'verify-244-play.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'athlete_performances context columns', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athlete_performances'
   AND column_name IN ('context_key', 'side', 'outcome')

UNION ALL
SELECT 'athlete_performances context CHECKs', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN ('athlete_performances_context_key_check', 'athlete_performances_side_check',
    'athlete_performances_outcome_check', 'athlete_performances_context_parts_check')

UNION ALL
SELECT 'the context index is partial', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_athlete_performances_context'
   AND indexdef LIKE '%context_key IS NOT NULL%'

UNION ALL
SELECT 'the four play tables', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public'
   AND table_name IN ('badge_awards', 'athlete_rivalry_display', 'challenges', 'live_cheers')

UNION ALL
SELECT 'posture A: RLS on, no policies', '4|0',
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relrowsecurity
           AND c.relname IN ('badge_awards', 'athlete_rivalry_display', 'challenges', 'live_cheers'))::text || '|' ||
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
           AND tablename IN ('badge_awards', 'athlete_rivalry_display', 'challenges', 'live_cheers'))::text,
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relrowsecurity
                     AND c.relname IN ('badge_awards', 'athlete_rivalry_display', 'challenges', 'live_cheers')) = 4
             AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
                   AND tablename IN ('badge_awards', 'athlete_rivalry_display', 'challenges', 'live_cheers')) = 0
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'no API role holds a privilege on the play tables', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
   AND table_name IN ('badge_awards', 'athlete_rivalry_display', 'challenges', 'live_cheers')

UNION ALL
SELECT 'play table CHECKs', '14', count(*)::text,
       CASE WHEN count(*) = 14 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN (
    'badge_awards_badge_key_check', 'badge_awards_sport_key_check', 'badge_awards_source_key_check', 'badge_awards_detail_check',
    'athlete_rivalry_display_sport_key_check', 'athlete_rivalry_display_self_check',
    'challenges_sport_key_check', 'challenges_metric_check', 'challenges_direction_check', 'challenges_status_check',
    'challenges_people_check', 'challenges_window_check', 'challenges_won_check',
    'live_cheers_cheer_check')

UNION ALL
SELECT 'play indexes', '9', count(*)::text,
       CASE WHEN count(*) = 9 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
    'idx_badge_awards_source', 'idx_athlete_rivalry_display_opponent',
    'idx_challenges_challengee', 'idx_challenges_challenger', 'idx_challenges_course', 'idx_challenges_open_ends',
    'idx_live_cheers_context', 'idx_live_cheers_profile', 'idx_live_cheers_target')

UNION ALL
SELECT 'challenges.updated_at trigger', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname = 'challenges_updated_at' AND NOT tgisinternal

UNION ALL
SELECT 'notifications admit challenge + challenge_result (and keep 242''s)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check'
   AND pg_get_constraintdef(oid) LIKE '%''challenge''%' AND pg_get_constraintdef(oid) LIKE '%challenge_result%'
   AND pg_get_constraintdef(oid) LIKE '%team_roster%'

UNION ALL
SELECT 'notification_preferences.challenges_enabled defaults true', 'true', max(column_default),
       CASE WHEN max(column_default) = 'true' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_preferences'
   AND column_name = 'challenges_enabled'

UNION ALL
SELECT 'reserved handle r', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM reserved_handles WHERE handle = 'r'

UNION ALL
SELECT 'INFO performance rows (context filled by the backfill in P2)', '-', count(*)::text || ' / ' || count(context_key)::text, 'INFO'
  FROM public.athlete_performances

UNION ALL
SELECT 'ledger head', '244', max(number)::text,
       CASE WHEN max(number) >= 244 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.schema_migrations;
