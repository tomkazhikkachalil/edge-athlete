-- ============================================================================
-- 268: the Overview's two schedules — pg_cron probes /api/cron/health-sample
--      every 5 minutes and runs /api/cron/platform-rollup at 00:10 UTC
--      (Oct 19 2026; the flow changes program, item 2b — H3. Runs on BOTH
--      databases AFTER H3 deployed: a scheduled call to a route that is not
--      there yet is a 404 every five minutes.)
-- ============================================================================
-- Nothing here changes a row: this file is the schedules alone, created ONLY
-- where the urgent-emails job already runs (248's detector, 255's shape) —
-- staging schedules nothing, by decision; its daily cron phase re-asserts the
-- rollup there and its Overview says "no sampler here".
--
-- Why 10 s: the rollup route answers 202 at once and works through
-- `waitUntil` (the media-jobs shape); the sampler does one index HEAD and
-- one INSERT. pg_net's client never waits on either.
--
-- Why 00:10 UTC: the day's rows are final ten minutes after midnight UTC
-- (the project's day convention); the owner's clock is Eastern (20:10) —
-- move the hour when platform_jobs.duration_ms for platform-rollup grows
-- past a few seconds.
--
-- Reversal (data-safe): SELECT cron.unschedule('platform-health-sample');
--                       SELECT cron.unschedule('platform-rollup');
-- ============================================================================

DO $job$
DECLARE
  auth_header text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT substring(command FROM 'Bearer [^'']+') INTO auth_header
      FROM cron.job WHERE jobname = 'urgent-emails' AND active LIMIT 1;
    IF auth_header IS NULL OR auth_header LIKE '%__CRON_SECRET__%' THEN
      RAISE NOTICE '268: no live urgent-emails job here — nothing scheduled (expected on staging)';
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-health-sample') THEN
        PERFORM cron.unschedule('platform-health-sample');
      END IF;
      PERFORM cron.schedule('platform-health-sample', '*/5 * * * *', format($cmd$
        SELECT net.http_post(
          url := 'https://edgeathlete.ca/api/cron/health-sample',
          headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'),
          body := '{}'::jsonb,
          timeout_milliseconds := 10000
        )
      $cmd$, auth_header));
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-rollup') THEN
        PERFORM cron.unschedule('platform-rollup');
      END IF;
      PERFORM cron.schedule('platform-rollup', '10 0 * * *', format($cmd$
        SELECT net.http_post(
          url := 'https://edgeathlete.ca/api/cron/platform-rollup',
          headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'),
          body := '{}'::jsonb,
          timeout_milliseconds := 10000
        )
      $cmd$, auth_header));
      RAISE NOTICE '268: platform-health-sample (every 5 min) and platform-rollup (00:10 UTC) scheduled';
    END IF;
  ELSE
    RAISE NOTICE '268: pg_cron/pg_net not installed here — nothing scheduled';
  END IF;
END $job$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (268, '268_platform_schedules.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on production: 268 APPLIED | 2 | 268   (staging: 0 jobs, by decision)
SELECT '268 APPLIED' AS result,
       (SELECT count(*) FROM cron.job WHERE jobname IN ('platform-health-sample', 'platform-rollup')) AS cron_jobs_prod_2,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_268;
