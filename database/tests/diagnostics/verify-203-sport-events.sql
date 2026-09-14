-- ============================================================================
-- Verify migration 203 (the round / post links on group_posts and posts)
-- ============================================================================
-- READ ONLY. Safe to run any time. The two columns and their partial unique indexes exist; the 'nothing attached yet' row reads 0 until the first event goes live, then counts attachments (a later PR changes that expectation on purpose).
-- Every row should read OK.
-- ============================================================================

SELECT 'group_posts.sport_event_round_id' AS check_name, '1' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_posts' AND column_name = 'sport_event_round_id'

UNION ALL

SELECT 'posts.sport_event_round_id', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'sport_event_round_id'

UNION ALL

SELECT 'partial unique indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_group_posts_sport_event_round', 'idx_posts_sport_event_round')

UNION ALL

SELECT 'nothing attached yet', '0', (SELECT count(*) FROM group_posts WHERE sport_event_round_id IS NOT NULL)::text || '+' || (SELECT count(*) FROM posts WHERE sport_event_round_id IS NOT NULL)::text,
       CASE WHEN (SELECT count(*) FROM group_posts WHERE sport_event_round_id IS NOT NULL) + (SELECT count(*) FROM posts WHERE sport_event_round_id IS NOT NULL) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

ORDER BY 1;
