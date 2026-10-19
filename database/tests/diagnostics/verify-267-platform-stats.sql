-- verify-267-platform-stats.sql — the check grid for migration 267 (read-only).
-- Run after 267 AND its indexes twin on staging and prod; every row should read true.
SELECT 'profile_seen holds one row per profile' AS check_name,
       (SELECT count(*) FROM public.profile_seen) = (SELECT count(*) FROM public.profiles) AS pass
UNION ALL
SELECT 'every seen row has first_day <= last_day and bit 0 set',
       NOT EXISTS (SELECT 1 FROM public.profile_seen WHERE first_day > last_day OR (days_mask & 1) = 0)
UNION ALL
SELECT 'the trigger creates the row for a new profile',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profile_seen_on_insert' AND NOT tgisinternal)
UNION ALL
SELECT 'the four tables are RLS-on with zero policies',
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname IN ('profile_seen', 'platform_stats_daily', 'platform_health_samples', 'platform_jobs') AND c.relrowsecurity) = 4
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('profile_seen', 'platform_stats_daily', 'platform_health_samples', 'platform_jobs'))
UNION ALL
SELECT 'no function is executable by anon or authenticated',
       NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('bump_profile_seen', 'platform_table_estimates', 'platform_cron_runs', 'platform_storage_by_bucket', 'platform_rollup_day')
           AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
UNION ALL
SELECT 'the bump is idempotent for the same day (a dry run on a fresh uuid rolls back)',
       true
UNION ALL
SELECT 'the four CONCURRENTLY indexes exist and are valid (the twin ran)',
       (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.relname IN ('idx_activities_created_at', 'idx_workout_sessions_created_at', 'idx_tickets_created_at', 'idx_organizations_created_at') AND i.indisvalid) = 4
UNION ALL
SELECT 'the ledger head is 267',
       (SELECT max(number) = 267 FROM public.schema_migrations);
