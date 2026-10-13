-- ============================================================================
-- 262: the media worker's schedule — pg_cron ticks /api/cron/media-jobs every
--      minute (Oct 13 2026; the video posters program's SECOND and LAST DDL
--      file; runs on BOTH staging and prod AFTER PR 7 (the worker) deployed —
--      the route answers 409 while 261 is missing and 202 at once otherwise)
-- ============================================================================
-- The worker (261's media_jobs; src/lib/media/process-server.ts) converts an
-- iPhone's HEVC clip, grabs a missing poster and a blur hash. Nothing here
-- changes a row: this file is the schedule alone, created ONLY where the
-- urgent-emails job already runs (248's detector, 255's shape) — staging
-- schedules nothing, by decision; the dashboard panel is its door there.
--
-- Why 10 s: the tick CLAIMS its jobs, answers 202 at once and does the work
-- through `waitUntil` (a 300 s function) — pg_net's client never waits on a
-- transcode. The other crons keep 55 s because their routes answer when done.
--
-- Reversal (data-safe): SELECT cron.unschedule('media-jobs');

DO $job$
DECLARE
  auth_header text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT substring(command FROM 'Bearer [^'']+') INTO auth_header
      FROM cron.job WHERE jobname = 'urgent-emails' AND active LIMIT 1;
    IF auth_header IS NULL OR auth_header LIKE '%__CRON_SECRET__%' THEN
      RAISE NOTICE '262: no live urgent-emails job here — media-jobs NOT scheduled (expected on staging)';
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'media-jobs') THEN
        PERFORM cron.unschedule('media-jobs');
      END IF;
      PERFORM cron.schedule('media-jobs', '* * * * *', format($cmd$
        SELECT net.http_post(
          url := 'https://edgeathlete.ca/api/cron/media-jobs',
          headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'),
          body := '{}'::jsonb,
          timeout_milliseconds := 10000
        )
      $cmd$, auth_header));
      RAISE NOTICE '262: media-jobs scheduled (every minute)';
    END IF;
  ELSE
    RAISE NOTICE '262: pg_cron/pg_net not installed here — media-jobs NOT scheduled';
  END IF;
END $job$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (262, '262_media_jobs_schedule.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on production: 262 APPLIED | 1 | 1 | 262
-- (staging: the job column reads 0 — no pg_cron jobs there, by decision)
SELECT '262 APPLIED' AS result,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'media_jobs') AS jobs_table_expect_1,
       (SELECT count(*) FROM cron.job WHERE jobname = 'media-jobs') AS cron_job_prod_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_262;
