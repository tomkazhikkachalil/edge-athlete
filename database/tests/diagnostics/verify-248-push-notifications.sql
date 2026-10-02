-- ============================================================================
-- Verify migration 248 (phone notifications: push_subscriptions, the
-- notifications.pushed_at stamp, the push-sweep job)
-- ============================================================================
-- READ ONLY, runnable before 248 (the structural rows read CHECK FAILED) and
-- after (every row OK; the job row reads OK on production and NOT HERE on
-- staging, which runs no pg_cron jobs by decision). The migration ends in ONE
-- result row ("248 APPLIED | 1 | 1 | 0 | 0 | 1 | 248").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-248-push-notifications.sql' AS expected, 'verify-248-push-notifications.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'the push_subscriptions table', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_subscriptions'

UNION ALL
SELECT 'push_subscriptions columns', '10', count(*)::text,
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'push_subscriptions'

UNION ALL
SELECT 'posture A: RLS on, no policies', '1|0',
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'push_subscriptions' AND c.relrowsecurity)::text || '|' ||
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'push_subscriptions')::text,
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname = 'push_subscriptions' AND c.relrowsecurity) = 1
             AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'push_subscriptions') = 0
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL
SELECT 'no API role holds a grant', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND grantee IN ('anon', 'authenticated', 'PUBLIC')

UNION ALL
SELECT 'named constraints (pkey, endpoint uniq, FK)', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint
 WHERE conname IN ('push_subscriptions_pkey', 'push_subscriptions_endpoint_uniq', 'push_subscriptions_profile_id_fkey')

UNION ALL
SELECT 'notifications.pushed_at', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'pushed_at'

UNION ALL
SELECT 'idx_notifications_unpushed', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_notifications_unpushed'

UNION ALL
SELECT 'nothing older than 5 min waits to be pushed', '0',
       count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.notifications n
 WHERE (to_jsonb(n) -> 'pushed_at') = 'null'::jsonb
   AND n.created_at < now() - interval '5 minutes'

UNION ALL
SELECT 'the ledger row', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.schema_migrations WHERE number = 248;

-- The job (production only — run separately; errors where pg_cron is absent):
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'push-sweep';
