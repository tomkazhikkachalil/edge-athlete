-- verify-262-media-jobs-schedule.sql — the check grid for migration 262 (read-only).
-- Run after 262 on staging and prod; every row should read true except the
-- cron rows, which are false on staging by decision.
SELECT 'the media-jobs cron job exists (prod)' AS check_name,
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'media-jobs' AND active) AS pass
UNION ALL
SELECT 'it runs every minute and posts to /api/cron/media-jobs with a 10 s client timeout (prod)',
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'media-jobs' AND schedule = '* * * * *'
                 AND command LIKE '%/api/cron/media-jobs%' AND command LIKE '%timeout_milliseconds := 10000%')
UNION ALL
SELECT 'it carries the same bearer as urgent-emails (prod)',
       (SELECT substring(a.command FROM 'Bearer [^'']+') = substring(b.command FROM 'Bearer [^'']+')
          FROM cron.job a, cron.job b WHERE a.jobname = 'media-jobs' AND b.jobname = 'urgent-emails')
UNION ALL
SELECT 'the job table it ticks exists (261)',
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'media_jobs')
UNION ALL
SELECT 'the ledger head is 262',
       (SELECT max(number) = 262 FROM public.schema_migrations);
