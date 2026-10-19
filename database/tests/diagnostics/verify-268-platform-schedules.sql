-- verify-268-platform-schedules.sql — the check grid for migration 268 (read-only).
-- Run after 268 on staging and prod; every row should read true except the
-- cron rows, which are false on staging by decision.
SELECT 'the health sampler job exists and runs every 5 minutes (prod)' AS check_name,
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-health-sample' AND active AND schedule = '*/5 * * * *'
                 AND command LIKE '%/api/cron/health-sample%' AND command LIKE '%timeout_milliseconds := 10000%') AS pass
UNION ALL
SELECT 'the rollup job exists and runs at 00:10 UTC (prod)',
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-rollup' AND active AND schedule = '10 0 * * *'
                 AND command LIKE '%/api/cron/platform-rollup%')
UNION ALL
SELECT 'both carry the same bearer as urgent-emails (prod)',
       (SELECT count(*) = 2 FROM cron.job a, cron.job b
          WHERE a.jobname IN ('platform-health-sample', 'platform-rollup') AND b.jobname = 'urgent-emails'
            AND substring(a.command FROM 'Bearer [^'']+') = substring(b.command FROM 'Bearer [^'']+'))
UNION ALL
SELECT 'the sampler has written a row in the last 10 minutes (prod, after the first tick)',
       EXISTS (SELECT 1 FROM public.platform_health_samples WHERE at > now() - interval '10 minutes')
UNION ALL
SELECT 'the ledger head is 268',
       (SELECT max(number) = 268 FROM public.schema_migrations);
