-- ============================================================================
-- 246: the two pg_cron jobs call the official domain (go-live, Phase 7)
-- ============================================================================
-- RUN ONLY AFTER edgeathlete.ca SERVES THE APP (docs/GO_LIVE_EDGEATHLETE_CA.md
-- Phases 3–4 done: Vercel shows the domain Valid, NEXT_PUBLIC_APP_URL is set
-- and built). Run earlier and both jobs would call GoDaddy's page every ten
-- minutes and silently do nothing.
--
-- 059 scheduled `calendar-reminders` and 135 `urgent-emails` as pg_net GETs
-- to https://edge-athlete.vercel.app/api/cron/…, with the CRON_SECRET baked
-- into each job's command at run time. This migration rewrites ONLY the host
-- inside each existing command (cron.alter_job + replace), so the secret is
-- never re-typed and never appears here. The vercel.app address keeps
-- serving production, so the old URL was never broken — this is the move,
-- not a repair.
--
-- Staging has no pg_cron jobs by decision: there the body is a no-op and the
-- ledger row still lands (the chain stays identical on both).
--
-- REVERSAL: the same statement with the two hosts swapped.
-- ============================================================================

-- The result row reads this, so it never names cron.* (absent on staging).
CREATE TEMP TABLE _m246 (moved int, on_new int, on_old int) ON COMMIT DROP;

DO $$
DECLARE
  n int;
  moved int := 0;
  on_new int := 0;
  on_old int := 0;
  j record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 246) THEN
    RAISE EXCEPTION '246 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 245 THEN RAISE EXCEPTION '246 pre-flight: ledger head is %, expected 245', n; END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR j IN
      SELECT jobid, jobname FROM cron.job
       WHERE jobname IN ('calendar-reminders', 'urgent-emails')
         AND command LIKE '%https://edge-athlete.vercel.app/%'
    LOOP
      PERFORM cron.alter_job(
        j.jobid,
        command := (SELECT replace(command, 'https://edge-athlete.vercel.app/', 'https://edgeathlete.ca/') FROM cron.job WHERE jobid = j.jobid)
      );
      moved := moved + 1;
      RAISE NOTICE '246: % now calls https://edgeathlete.ca', j.jobname;
    END LOOP;
    SELECT count(*) INTO on_new FROM cron.job
     WHERE jobname IN ('calendar-reminders', 'urgent-emails') AND command LIKE '%https://edgeathlete.ca/%';
    SELECT count(*) INTO on_old FROM cron.job WHERE command LIKE '%edge-athlete.vercel.app%';
  END IF;
  INSERT INTO _m246 VALUES (moved, on_new, on_old);
  RAISE NOTICE '246: % job(s) moved', moved;
END $$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (246, '246_cron_host_edgeathlete_ca.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on PROD: 246 APPLIED | 2 | 2 | 0 | 246   (staging: 246 APPLIED | 0 | 0 | 0 | 246)
SELECT '246 APPLIED' AS result,
       moved AS moved_expect_2,
       on_new AS jobs_on_new_host_expect_2,
       on_old AS jobs_on_old_host_expect_0,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_246
  FROM _m246;
