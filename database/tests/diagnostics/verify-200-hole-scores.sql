-- ============================================================================
-- Verify migration 200 (golf_hole_scores: the creator may UPDATE)
-- ============================================================================
-- READ ONLY. Safe to run any time. The update policy carries the creator
-- branch, the insert policy is unchanged, the table still has four policies
-- and the public total is 172 (the Sep 16 2026 catalog's). Every row OK.
-- ============================================================================

SELECT 'golf_hole_scores: policies' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores'

UNION ALL

SELECT 'hole_scores_update_policy: creator branch', 'true',
       COALESCE((SELECT (qual LIKE '%creator_id%')::text FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_update_policy'), '-'),
       CASE WHEN (SELECT qual LIKE '%creator_id%' FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_update_policy')
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'hole_scores_insert_policy: unchanged (creator branch)', 'true',
       COALESCE((SELECT (with_check LIKE '%creator_id%')::text FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_insert_policy'), '-'),
       CASE WHEN (SELECT with_check LIKE '%creator_id%' FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_insert_policy')
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'public policies total', '172', count(*)::text,
       CASE WHEN count(*) = 172 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public'

ORDER BY 1;
