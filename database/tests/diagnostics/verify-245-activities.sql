-- ============================================================================
-- Verify migration 245 (activities: the imported-activity table; reserved
-- 'activities')
-- ============================================================================
-- READ ONLY, runnable before 245 (the structural rows read CHECK FAILED) and
-- after (every row OK). The migration ends in ONE result row
-- ("245 APPLIED | 1 | 1 | 0 | 1 | 245").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-245-activities.sql' AS expected, 'verify-245-activities.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'the activities table', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activities'

UNION ALL
SELECT 'activities columns', '27', count(*)::text,
       CASE WHEN count(*) = 27 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activities'

UNION ALL
SELECT 'posture A: RLS on, no policies', '1|0',
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'activities' AND c.relrowsecurity)::text || '|' ||
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activities')::text,
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname = 'activities' AND c.relrowsecurity) = 1
             AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activities') = 0
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'no API role holds a grant', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'activities' AND grantee IN ('anon', 'authenticated', 'PUBLIC')

UNION ALL
SELECT 'named constraints (pkey, uniq, 2 FKs)', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN ('activities_pkey', 'activities_source_uniq', 'activities_profile_id_fkey', 'activities_post_id_fkey')

UNION ALL
SELECT 'profile FK cascades, post FK sets null', 'c|n',
       (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'activities_profile_id_fkey') || '|' ||
       (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'activities_post_id_fkey'),
       CASE WHEN (SELECT confdeltype FROM pg_constraint WHERE conname = 'activities_profile_id_fkey') = 'c'
             AND (SELECT confdeltype FROM pg_constraint WHERE conname = 'activities_post_id_fkey') = 'n'
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'indexes (profile+started, post)', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'activities'
   AND indexname IN ('idx_activities_profile_started', 'idx_activities_post')

UNION ALL
SELECT 'the updated_at trigger', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname = 'activities_updated_at' AND NOT tgisinternal

UNION ALL
SELECT 'activities reserved', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM reserved_handles WHERE handle = 'activities'

UNION ALL
SELECT 'ledger head', '245', max(number)::text,
       CASE WHEN max(number) = 245 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.schema_migrations

ORDER BY 1;
