-- ============================================================================
-- 248: phone notifications — the installed app's push subscriptions, the
--      "already pushed" stamp on a notification, and the one-minute sweep
--      (additive; runs on BOTH staging and prod; the code degrades by name
--      until it has)
-- ============================================================================
-- Tom (Oct 2 2026): "Add an app icon indicator on mobile to signal when new or
-- relevant activity is available while the user is outside the app. Tapping
-- into the app should open the relevant area." A number on the icon while the
-- app is CLOSED needs a push (iPhone: every push shows a banner — Apple allows
-- no silent badge for web apps). Tom chose: everything the bell gets pushes.
-- This file is the round's ONLY DDL:
--
--   1. push_subscriptions — ONE row per device that turned phone notifications
--      on (a browser's PushSubscription: the push service's endpoint + the two
--      keys the payload is encrypted to). A person may have several devices.
--      Posture A: RLS on, no policies, service role only — the routes in
--      src/app/api/push/ are the access rule. Pruned by the sender when the
--      push service answers 404/410 (the device unsubscribed).
--   2. notifications.pushed_at — the sweep's stamp. The ~60 writers and the
--      seven 190 triggers stay untouched: a row with pushed_at NULL is a row
--      not yet considered, and the sweep (src/lib/push/sweep-server.ts, the
--      ONE sender) stamps every row it scans, pushed or not. Every existing
--      row is stamped here so nothing old is ever sent.
--   3. The `push-sweep` pg_cron job, every minute, calling
--      POST /api/push/sweep. It is scheduled ONLY where the `urgent-emails`
--      job already runs (production — staging has no pg_cron jobs, by
--      decision) and it copies that job's Authorization header, so this file
--      carries no secret and needs no hand edit.
--
-- The table is created EMPTY, so its indexes are inline (MIGRATIONS "Large-
-- table indexes"). The partial index on notifications is small by
-- construction: after the backfill only rows from the last minute match.
--
-- REVERSAL: SELECT cron.unschedule('push-sweep'); DROP TABLE
-- public.push_subscriptions; ALTER TABLE public.notifications DROP COLUMN
-- pushed_at. Re-runnable until the ledger row lands; a second run stops in
-- the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 248) THEN
    RAISE EXCEPTION '248 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 247 THEN RAISE EXCEPTION '248 pre-flight: ledger head is %, expected 247', n; END IF;
END $$;

-- ── 1. push_subscriptions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  profile_id       uuid        NOT NULL,
  endpoint         text        NOT NULL CONSTRAINT push_subscriptions_endpoint_check
                               CHECK (endpoint ~ '^https://' AND length(endpoint) BETWEEN 12 AND 2000),
  p256dh           text        NOT NULL CONSTRAINT push_subscriptions_p256dh_check
                               CHECK (length(p256dh) BETWEEN 16 AND 200),
  auth             text        NOT NULL CONSTRAINT push_subscriptions_auth_check
                               CHECK (length(auth) BETWEEN 8 AND 100),
  user_agent       text        CONSTRAINT push_subscriptions_user_agent_check
                               CHECK (user_agent IS NULL OR length(user_agent) <= 400),
  failure_count    integer     NOT NULL DEFAULT 0 CONSTRAINT push_subscriptions_failure_count_check
                               CHECK (failure_count >= 0),
  last_success_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at       timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_pkey;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
-- A device's endpoint is globally unique: a second sign-in on the same phone
-- moves the row to the new person (the route upserts on it).
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_uniq;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_uniq UNIQUE (endpoint);
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_profile_id_fkey;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile ON public.push_subscriptions (profile_id);
DROP TRIGGER IF EXISTS push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.push_subscriptions IS 'Phone notifications (248): one row per device that turned them on (a Web Push subscription). Written by /api/push/subscriptions; pruned by src/lib/push/send-server.ts on 404/410. Posture A: service role only.';

-- ── 2. notifications.pushed_at ──────────────────────────────────────────────
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS pushed_at timestamptz;
UPDATE public.notifications SET pushed_at = created_at WHERE pushed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_unpushed
  ON public.notifications (created_at)
  WHERE pushed_at IS NULL;
COMMENT ON COLUMN public.notifications.pushed_at IS
  'When the push sweep considered this row (248) — stamped whether or not a device received it; NULL = not yet considered.';

NOTIFY pgrst, 'reload schema';

-- ── 3. The one-minute sweep (only where urgent-emails already runs) ─────────
DO $job$
DECLARE
  auth_header text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT substring(command FROM 'Bearer [^'']+') INTO auth_header
      FROM cron.job WHERE jobname = 'urgent-emails' AND active LIMIT 1;
    IF auth_header IS NULL OR auth_header LIKE '%__CRON_SECRET__%' THEN
      RAISE NOTICE '248: no live urgent-emails job here — push-sweep NOT scheduled (expected on staging)';
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-sweep') THEN
        PERFORM cron.unschedule('push-sweep');
      END IF;
      PERFORM cron.schedule('push-sweep', '* * * * *', format($cmd$
        SELECT net.http_post(
          url := 'https://edgeathlete.ca/api/push/sweep',
          headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        )
      $cmd$, auth_header));
      RAISE NOTICE '248: push-sweep scheduled (every minute)';
    END IF;
  ELSE
    RAISE NOTICE '248: pg_cron/pg_net not installed here — push-sweep NOT scheduled';
  END IF;
END $job$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (248, '248_push_notifications.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on production: 248 APPLIED | 1 | 1 | 0 | 0 | 1 | 248
-- (staging: the job column reads 0 — no pg_cron jobs there, by decision)
SELECT '248 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_subscriptions') AS table_expect_1,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'push_subscriptions' AND c.relrowsecurity) AS rls_on_expect_1,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'push_subscriptions') AS policies_expect_0,
       (SELECT count(*) FROM public.notifications WHERE pushed_at IS NULL) AS unpushed_expect_0,
       (SELECT count(*) FROM pg_extension WHERE extname = 'pg_cron') AS cron_installed,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_248;
