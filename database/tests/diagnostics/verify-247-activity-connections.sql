-- ============================================================================
-- Verify migration 247 (activity connections: the connections table; the
-- sources an activity may come from)
-- ============================================================================
-- READ ONLY, runnable before 247 (the structural rows read CHECK FAILED) and
-- after (every row OK). The migration ends in ONE result row
-- ("247 APPLIED | 1 | 1 | 0 | 8 | 247").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-247-activity-connections.sql' AS expected, 'verify-247-activity-connections.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'the activity_connections table', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activity_connections'

UNION ALL
SELECT 'activity_connections columns', '12', count(*)::text,
       CASE WHEN count(*) = 12 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activity_connections'

UNION ALL
SELECT 'posture A: RLS on, no policies', '1|0',
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'activity_connections' AND c.relrowsecurity)::text || '|' ||
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_connections')::text,
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname = 'activity_connections' AND c.relrowsecurity) = 1
             AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_connections') = 0
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'no API role holds a grant', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'activity_connections' AND grantee IN ('anon', 'authenticated', 'PUBLIC')

UNION ALL
SELECT 'named constraints (pkey, uniq, FK, parts)', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN ('activity_connections_pkey', 'activity_connections_profile_provider_uniq',
                                       'activity_connections_profile_id_fkey', 'activity_connections_parts_check')

UNION ALL
SELECT 'profile FK cascades', 'c',
       coalesce((SELECT confdeltype::text FROM pg_constraint WHERE conname = 'activity_connections_profile_id_fkey'), '-'),
       CASE WHEN (SELECT confdeltype FROM pg_constraint WHERE conname = 'activity_connections_profile_id_fkey') = 'c'
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'unique indexes (token hash, provider user)', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'activity_connections'
   AND indexname IN ('idx_activity_connections_token_hash', 'idx_activity_connections_provider_user')
   AND indexdef LIKE 'CREATE UNIQUE INDEX%'

UNION ALL
SELECT 'the updated_at trigger', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname = 'activity_connections_updated_at' AND NOT tgisinternal

UNION ALL
SELECT 'activities.source admits 8 sources', '8',
       (SELECT count(*) FROM regexp_matches(
          coalesce((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                     WHERE conname = 'activities_source_check' AND conrelid = 'public.activities'::regclass), ''),
          '''[a-z_]+''', 'g'))::text,
       CASE WHEN (SELECT count(*) FROM regexp_matches(
          coalesce((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                     WHERE conname = 'activities_source_check' AND conrelid = 'public.activities'::regclass), ''),
          '''[a-z_]+''', 'g')) = 8
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'no activity holds a source outside the list', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.activities
 WHERE source NOT IN ('file', 'upload_link', 'polar', 'wahoo', 'coros', 'suunto', 'garmin', 'google_health')

UNION ALL
SELECT 'ledger head', '247', max(number)::text,
       CASE WHEN max(number) = 247 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.schema_migrations

ORDER BY 1;
