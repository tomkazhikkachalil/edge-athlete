-- ============================================================================
-- 272: pg_net leaves `public` — the Security Advisor's extension_in_public
--      (Oct 25 2026). Runs on BOTH staging and prod; no code change rides
--      with it, nothing deploys first or after. ONE transaction.
-- ============================================================================
-- 257 (Oct 9) ACCEPTED this warning: "pg_net does not support SET SCHEMA;
-- moving it means DROP + CREATE, which pauses the pg_cron jobs that call
-- net.http_post." Both halves are true — and re-examined, neither bites:
--
--  * pg_net is NON-RELOCATABLE (Supabase's pg_net docs, Troubleshooting →
--    "Security Advisor flags pg_net in public"): the documented fix is
--    exactly `drop extension pg_net; create extension pg_net with schema
--    extensions;` in the SQL editor. Its objects (net.http_get / http_post,
--    net.http_request_queue, net._http_response) live in schema `net`
--    whatever the extension's own namespace is; only pg_extension's record
--    sits in public (059 and 135 created it without a schema).
--  * The "pause" is this transaction. The seven pg_cron jobs that call
--    net.* — calendar-reminders, urgent-emails (059/135, host rewritten by
--    246), push-sweep (248), golf-map-sweep (255), media-jobs (262),
--    platform-health-sample and platform-rollup (268) — are SQL STRINGS in
--    cron.job.command, never functions: pg_cron's rows are data, not
--    extension dependents, so DROP EXTENSION (no CASCADE) leaves them where
--    they are. The CRON_SECRET is literal text inside those commands (059's
--    by-hand replace; 248/255/262/268 copy the Bearer header from the live
--    urgent-emails row) and survives with them. cron-history-prune (249)
--    never touches net.*. No function body in the chain calls net.*;
--    nothing grants on `net` or sets a pg_net GUC. The jobs exist on
--    PRODUCTION only (staging has no cron jobs by decision, 246).
--  * What IS lost: net.http_request_queue (requests not yet sent) and
--    net._http_response (6 h of diagnostics). Every queued request is a
--    fire-and-forget ping to one of our own cron routes, which re-fires
--    every 1–10 minutes and claims its work idempotently — one minute's
--    queue is harmless. A job that fires during the transaction waits on
--    the lock or logs one failed run in cron.job_run_details.
--  * Ownership: Supabase's extension manager escalates trusted extensions,
--    so pg_extension.extowner is supabase_admin on both databases even
--    though 059 ran as postgres from the SQL editor (staging confirmed it,
--    Oct 25). The same manager runs DROP / CREATE EXTENSION for the postgres
--    role; the staging run is the proof. If the DROP is refused, the whole
--    transaction fails and nothing changes — the fallback is the Dashboard
--    (Database → Extensions → pg_net off, then on with schema `extensions`).
--  * CREATE EXTENSION re-applies pg_net's own grants (USAGE on `net` to
--    PUBLIC, EXECUTE on its functions), so the jobs — which run as postgres —
--    call net.http_post exactly as before. The baseline generator copies
--    the live extension schema (emitExtensions), so the next
--    `npm run build:baseline` writes `WITH SCHEMA extensions` by itself.
--
-- Pre-flight (the Advisor's lint in SQL — 1 row before, 0 after):
--   SELECT e.extname, e.extowner::regrole, n.nspname
--   FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
--   WHERE n.nspname = 'public';
--
-- After the run (prod, ~2 minutes): the jobs keep firing —
--   SELECT jobname, status, return_message, start_time
--   FROM cron.job_run_details d JOIN cron.job j USING (jobid)
--   WHERE start_time > now() - interval '5 minutes' ORDER BY start_time DESC;
--   SELECT count(*) FROM net._http_response WHERE created > now() - interval '5 minutes';
-- If no run succeeds and the response table stays empty, restart pg_net's
-- background worker: SELECT net.worker_restart();  (the docs' restart call;
-- a superuser grant is needed only for ALTER SYSTEM, not for this).
--
-- Reversal: `drop extension pg_net; create extension pg_net;` puts the record
-- back in public — pointless, recorded for completeness.
-- Re-runnable: already-moved → NOTICE and skip; the ledger row is ON CONFLICT.
-- ============================================================================

DO $$
DECLARE
  v_head   int;
  v_schema text;
  v_owner  text;
  v_queued bigint;
BEGIN
  SELECT max(number) INTO v_head FROM public.schema_migrations;
  IF v_head < 271 THEN
    RAISE EXCEPTION '272 needs the ledger at 271 first (head is %)', v_head;
  END IF;

  SELECT n.nspname, e.extowner::regrole::text INTO v_schema, v_owner
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_net';

  IF v_schema IS NULL THEN
    RAISE NOTICE '272: pg_net is not installed here — nothing to move (059/135 fall back to the daily sweeps)';
    RETURN;
  END IF;
  IF v_schema = 'extensions' THEN
    RAISE NOTICE '272: pg_net already lives in extensions — nothing to move';
    RETURN;
  END IF;
  IF v_schema <> 'public' THEN
    RAISE EXCEPTION '272: pg_net lives in schema % (expected public) — look before moving', v_schema;
  END IF;

  EXECUTE 'SELECT count(*) FROM net.http_request_queue' INTO v_queued;
  RAISE NOTICE '272: moving pg_net (owner %, schema %) — % queued request(s) will be dropped with the queue', v_owner, v_schema, v_queued;

  -- The move. Supabase projects already have `extensions`; IF NOT EXISTS keeps it idempotent.
  CREATE SCHEMA IF NOT EXISTS extensions;
  DROP EXTENSION pg_net;                              -- no CASCADE: nothing may depend on it
  CREATE EXTENSION pg_net WITH SCHEMA extensions;
END $$;

-- ── Verification that cannot roll the move back ──────────────────────────────
DO $$
DECLARE
  v_jobs int;
BEGIN
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
     OR to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NULL THEN
    RAISE WARNING '272: net.http_post / net.http_get did not resolve after the move';
  END IF;
  IF NOT has_schema_privilege('postgres', 'net', 'USAGE') THEN
    RAISE WARNING '272: postgres lost USAGE on schema net — the cron jobs run as postgres';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$ SELECT count(*) FROM cron.job
                 WHERE command LIKE '%net.http_%'
                   AND command LIKE '%Bearer %'
                   AND command NOT LIKE '%__CRON_SECRET__%' $q$ INTO v_jobs;
    RAISE NOTICE '272: % pg_cron job(s) call net.* with their secret in place (prod 7, staging 0)', v_jobs;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '272 verification: %', SQLERRM;
END $$;

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (272, '272_pg_net_extensions_schema.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected: staging 272 APPLIED | extensions | 0 | true | 0 | 272
--           prod    272 APPLIED | extensions | 0 | true | 7 | 272
SELECT '272 APPLIED' AS result,
       (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_net') AS pg_net_schema_expect_extensions,
       (SELECT count(*) FROM pg_extension WHERE extnamespace = 'public'::regnamespace) AS extensions_in_public_expect_0,
       (to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL) AS net_http_post_resolves_expect_true,
       (SELECT CASE WHEN to_regclass('cron.job') IS NULL THEN 0
                    ELSE (SELECT count(*) FROM cron.job WHERE command LIKE '%net.http_%' AND command LIKE '%Bearer %' AND command NOT LIKE '%__CRON_SECRET__%') END) AS net_jobs_prod_7_staging_0,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_272;
