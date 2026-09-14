-- ============================================================================
-- Verify migration 199 (cleanup) — the redundant objects are gone, the fold
-- holds, the totals match
-- ============================================================================
-- READ ONLY. Safe to run any time. Every row should read OK after 199 has
-- run; before it, the counts read the pre-199 state (verify-196 / 197 / 198
-- carry those). The expected totals — 172 policies, 105 functions, 97
-- non-internal triggers — are the Sep 14 2026 catalog's minus what 199
-- removed; a later migration that adds or drops one of these changes a
-- number here on purpose.
-- ============================================================================

SELECT 'golf_hole_scores: policies' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores'

UNION ALL

SELECT 'golf_hole_scores: select policy kept', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_select_policy'

UNION ALL

SELECT 'golf_participant_scores: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores'

UNION ALL

SELECT 'golf_scores_update_policy: creator branch folded in', 'true',
       COALESCE((SELECT (qual LIKE '%creator_id%')::text FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'golf_participant_scores' AND policyname = 'golf_scores_update_policy'), '-'),
       CASE WHEN (SELECT qual LIKE '%creator_id%' FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'golf_participant_scores' AND policyname = 'golf_scores_update_policy')
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'golf_scorecard_data: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data'

UNION ALL

SELECT 'post_likes: triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_likes'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'post_comments: triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_comments'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'group_posts: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.group_posts'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'mark_all_notifications_read overloads', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'mark_all_notifications_read'

UNION ALL

SELECT 'trigger functions: anon cannot execute', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('handle_updated_at', 'update_post_reposts_count', 'consent_records_forbid_mutation', 'notify_post_comment')
   AND has_function_privilege('anon', oid, 'EXECUTE')

UNION ALL

SELECT 'is_conversation_participant: authenticated still can', 'true',
       has_function_privilege('authenticated', 'public.is_conversation_participant(uuid, uuid)', 'EXECUTE')::text,
       CASE WHEN has_function_privilege('authenticated', 'public.is_conversation_participant(uuid, uuid)', 'EXECUTE') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'athlete_badges gone', 'true', (to_regclass('public.athlete_badges') IS NULL)::text,
       CASE WHEN to_regclass('public.athlete_badges') IS NULL THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'public policies total', '172', count(*)::text,
       CASE WHEN count(*) = 172 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public'

UNION ALL

SELECT 'public non-extension functions', '105', count(*)::text,
       CASE WHEN count(*) = 105 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM pg_depend x WHERE x.classid = 'pg_proc'::regclass AND x.objid = p.oid AND x.deptype = 'e')

UNION ALL

SELECT 'public non-internal triggers', '97', count(*)::text,
       CASE WHEN count(*) = 97 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal

ORDER BY 1;
