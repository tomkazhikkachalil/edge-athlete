-- ============================================================================
-- 267: the platform's own numbers (Oct 19 2026; the flow changes program,
--      item 2b — the admin Overview). Runs on BOTH staging and prod BEFORE H0
--      deploys. Nothing selects the new tables until then.
-- ============================================================================
-- Tom: "we need the ability to see all the stats about the app — health,
-- users, new users, posts … think of what would be useful if we reach a
-- billion people." The rule this migration builds (Convention 49): EVERY
-- number on the Overview is read from a SMALL table — counted once a night
-- over an index, estimated where exact would be a scan, sampled where it is
-- a probe. The page never counts a big table.
--
-- The model (every table posture A: RLS on, zero policies, REVOKE from
-- PUBLIC / anon / authenticated, GRANT service_role; every function
-- SECURITY DEFINER, EXECUTE for service_role only — the RPC grants rule):
--
--   profile_seen           ONE row per account: first_day (the SIGNUP day —
--                          a trigger + the seed below), last_day, days_mask
--                          (bit i, LSB = 0, means "seen on last_day - i";
--                          bit 0 is always set). ONE write per account per
--                          day through bump_profile_seen. DAU / WAU / MAU
--                          are index counts on last_day; D1 / D7 / D30
--                          retention is exact from the bitmap. Nothing about
--                          WHAT was done is kept — "active" means "opened
--                          the app signed in" (the app-shell beacon).
--   platform_stats_daily   (day, metric, dim) → value: the ONE table the
--                          Overview reads; platform_rollup_day fills it a
--                          group at a time.
--   platform_health_samples  one row per 5-minute probe (H3's sampler).
--   platform_jobs          one row per cron: its last run.
--
-- Deploy order: 267 (+ the CONCURRENTLY twin 267_platform_stats.indexes.sql,
-- each statement its own run) → H0 … H3 → 268 (the pg_cron schedules — a
-- scheduled call to a route that is not there yet is a 404 every minute).
--
-- REVERSAL: DROP the trigger + function profile_seen_on_profile_insert, the
-- four functions below, the four tables; drop the twin's indexes. Re-runnable
-- until the ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 267) THEN
    RAISE EXCEPTION '267 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 266 THEN RAISE EXCEPTION '267 pre-flight: ledger head is %, expected 266', n; END IF;
END $$;

-- ── 1. profile_seen ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_seen (
  profile_id uuid   PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_day  date   NOT NULL,
  last_day   date   NOT NULL,
  days_mask  bigint NOT NULL DEFAULT 1,
  CONSTRAINT profile_seen_order_check CHECK (first_day <= last_day)
) WITH (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.005);
-- Created empty here, so the indexes go inline (MIGRATIONS.md "Large-table indexes").
CREATE INDEX IF NOT EXISTS idx_profile_seen_last_day  ON public.profile_seen (last_day);
CREATE INDEX IF NOT EXISTS idx_profile_seen_first_day ON public.profile_seen (first_day);
ALTER TABLE public.profile_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_seen FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.profile_seen TO service_role;
COMMENT ON TABLE public.profile_seen IS 'One row per account (267): the signup day, the last day the app was opened signed in, and a 63-day bitmap of those days. Counts only; never shown per person.';

-- The bump: idempotent (the same or a past day changes nothing), ONE statement.
-- int8 << n is masked at 64 in Postgres (1 << 64 = 1): the shift is capped explicitly.
CREATE OR REPLACE FUNCTION public.bump_profile_seen(p_profile uuid, p_day date)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH w AS (
    INSERT INTO public.profile_seen AS s (profile_id, first_day, last_day, days_mask)
    VALUES (p_profile, p_day, p_day, 1)
    ON CONFLICT (profile_id) DO UPDATE
      SET last_day  = EXCLUDED.last_day,
          days_mask = CASE
                        WHEN EXCLUDED.last_day - s.last_day >= 64 THEN 1::bigint
                        ELSE (s.days_mask << (EXCLUDED.last_day - s.last_day)) | 1::bigint
                      END
      WHERE s.last_day < EXCLUDED.last_day
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM w);
$$;
REVOKE EXECUTE ON FUNCTION public.bump_profile_seen(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bump_profile_seen(uuid, date) TO service_role;

-- first_day is the SIGNUP day: every account from now on …
CREATE OR REPLACE FUNCTION public.profile_seen_on_profile_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_seen (profile_id, first_day, last_day, days_mask)
  VALUES (NEW.id, (NEW.created_at AT TIME ZONE 'UTC')::date, (NEW.created_at AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (profile_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.profile_seen_on_profile_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profile_seen_on_insert ON public.profiles;
CREATE TRIGGER profile_seen_on_insert AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profile_seen_on_profile_insert();
-- … and the seed for every account that already exists.
INSERT INTO public.profile_seen (profile_id, first_day, last_day, days_mask)
SELECT id, (created_at AT TIME ZONE 'UTC')::date, (created_at AT TIME ZONE 'UTC')::date, 1
FROM public.profiles
ON CONFLICT (profile_id) DO NOTHING;

-- ── 2. platform_stats_daily ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_stats_daily (
  day        date   NOT NULL,
  metric     text   NOT NULL CHECK (metric ~ '^[a-z0-9_.]+$'),
  dim        text   NOT NULL DEFAULT '' CHECK (length(dim) <= 80),
  value      bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (day, metric, dim)
);
ALTER TABLE public.platform_stats_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_stats_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.platform_stats_daily TO service_role;
COMMENT ON TABLE public.platform_stats_daily IS 'The Overview''s one table (267): one row per UTC day, metric and dimension, written a group at a time by platform_rollup_day.';

-- ── 3. platform_health_samples + platform_jobs ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_health_samples (
  at    timestamptz PRIMARY KEY,
  db_ms integer     NOT NULL CHECK (db_ms >= 0),
  ok    boolean     NOT NULL
);
ALTER TABLE public.platform_health_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_health_samples FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.platform_health_samples TO service_role;

CREATE TABLE IF NOT EXISTS public.platform_jobs (
  job              text PRIMARY KEY CHECK (job ~ '^[a-z][a-z0-9-]{1,60}$'),
  last_started_at  timestamptz NOT NULL,
  last_finished_at timestamptz,
  ok               boolean,
  duration_ms      integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  summary          jsonb
);
ALTER TABLE public.platform_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.platform_jobs TO service_role;

-- ── 4. The estimates, the pg_cron side, the storage sum ─────────────────────
-- Totals are pg_class estimates ("≈" on the page) with last_analyze shown: an
-- exact count of a billion rows is never run for a dashboard.
CREATE OR REPLACE FUNCTION public.platform_table_estimates()
RETURNS TABLE (relname text, reltuples bigint, last_analyze timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.relname::text,
         greatest(c.reltuples, 0)::bigint,
         greatest(s.last_analyze, s.last_autoanalyze)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE c.relkind = 'r'
    AND c.relname IN ('profiles', 'posts', 'activities', 'workout_sessions', 'follows', 'messages',
                      'notifications', 'organizations', 'sport_events', 'athlete_performances', 'profile_seen')
  ORDER BY c.relname;
$$;
REVOKE EXECUTE ON FUNCTION public.platform_table_estimates() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_table_estimates() TO service_role;

-- The pg_cron jobs that never touch an app route (push sweep, prunes): their
-- last run and the day's counts. Zero rows where the extension is absent.
CREATE OR REPLACE FUNCTION public.platform_cron_runs()
RETURNS TABLE (jobname text, schedule text, active boolean, last_start timestamptz, last_status text, runs_24h integer, failed_24h integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $q$
    SELECT j.jobname::text, j.schedule::text, j.active,
           (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid),
           (SELECT d.status::text FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1),
           (SELECT count(*)::int FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time >= now() - interval '24 hours'),
           (SELECT count(*)::int FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time >= now() - interval '24 hours' AND d.status <> 'succeeded')
    FROM cron.job j
    ORDER BY j.jobname
  $q$;
END $$;
REVOKE EXECUTE ON FUNCTION public.platform_cron_runs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_cron_runs() TO service_role;

-- A full scan of storage.objects: called by the NIGHTLY rollup only, never at
-- request time. The escape at scale is a per-bucket tally fed by the app's
-- own uploaders.
CREATE OR REPLACE FUNCTION public.platform_storage_by_bucket()
RETURNS TABLE (bucket text, objects bigint, bytes bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT o.bucket_id::text,
         count(*)::bigint,
         coalesce(sum(nullif(o.metadata->>'size', '')::bigint), 0)::bigint
  FROM storage.objects o
  GROUP BY o.bucket_id
  ORDER BY o.bucket_id;
$$;
REVOKE EXECUTE ON FUNCTION public.platform_storage_by_bucket() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_storage_by_bucket() TO service_role;

-- ── 5. The rollup: one UTC day, one GROUP at a time ─────────────────────────
-- Groups: users · cohorts · content · community · totals · storage · site.
-- p_partial = true computes [p_day, now()) and WRITES NOTHING (the Overview's
-- "today so far"); false DELETES the day's rows for the group's metrics and
-- INSERTS them in this one transaction (an upsert would leave a stale dim
-- behind on a recompute). Each count is an index range over that day's rows
-- (O(the day)), an index count on profile_seen (O(active accounts)), or an
-- estimate (O(1)); the caller (src/lib/platform-stats/rollup-server.ts)
-- controls the budget by choosing which groups to run.
CREATE OR REPLACE FUNCTION public.platform_rollup_day(p_day date, p_group text, p_partial boolean DEFAULT false)
RETURNS TABLE (metric text, dim text, value bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := (p_day::timestamp AT TIME ZONE 'UTC');
  v_end   timestamptz := CASE WHEN p_partial THEN now() ELSE ((p_day + 1)::timestamp AT TIME ZONE 'UTC') END;
  v_keys  text[];
BEGIN
  IF p_day > (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'platform_rollup_day: % is in the future', p_day;
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS tmp_rollup (metric text, dim text, value bigint) ON COMMIT DROP;
  DELETE FROM tmp_rollup;

  IF p_group = 'users' THEN
    v_keys := ARRAY['users.new', 'users.departed', 'users.deletion_requested', 'users.dau', 'users.wau', 'users.mau'];
    INSERT INTO tmp_rollup SELECT 'users.new', '', count(*) FROM profile_seen WHERE first_day = p_day;
    INSERT INTO tmp_rollup
      SELECT 'users.new', 'type:' || coalesce(p.user_type, 'unknown'), count(*)
      FROM profile_seen s JOIN profiles p ON p.id = s.profile_id
      WHERE s.first_day = p_day GROUP BY 2;
    INSERT INTO tmp_rollup SELECT 'users.departed', '', count(*) FROM profiles WHERE departed_at >= v_start AND departed_at < v_end;
    INSERT INTO tmp_rollup SELECT 'users.deletion_requested', '', count(*) FROM profiles WHERE deletion_requested_at >= v_start AND deletion_requested_at < v_end;
    INSERT INTO tmp_rollup SELECT 'users.dau', '', count(*) FROM profile_seen WHERE last_day = p_day;
    INSERT INTO tmp_rollup SELECT 'users.wau', '', count(*) FROM profile_seen WHERE last_day BETWEEN p_day - 6 AND p_day;
    INSERT INTO tmp_rollup SELECT 'users.mau', '', count(*) FROM profile_seen WHERE last_day BETWEEN p_day - 29 AND p_day;

  ELSIF p_group = 'cohorts' THEN
    -- Keyed by the COHORT day C = p_day - n: how many of C's signups were seen ON day p_day (strict Dn).
    v_keys := ARRAY['cohort.size', 'cohort.d1', 'cohort.d7', 'cohort.d30'];
    IF p_partial THEN RETURN; END IF;
    INSERT INTO tmp_rollup
      SELECT k.metric, k.dim, k.value FROM (
        SELECT 'cohort.size' AS metric, 'cohort:' || (p_day - n.n)::text AS dim, count(*) AS value
        FROM (VALUES (1), (7), (30)) n(n)
        JOIN profile_seen s ON s.first_day = p_day - n.n
        GROUP BY n.n
        UNION ALL
        SELECT 'cohort.d' || n.n::text, 'cohort:' || (p_day - n.n)::text,
               count(*) FILTER (WHERE s.last_day >= p_day AND s.last_day - p_day <= 63 AND ((s.days_mask >> (s.last_day - p_day)) & 1::bigint) = 1)
        FROM (VALUES (1), (7), (30)) n(n)
        JOIN profile_seen s ON s.first_day = p_day - n.n
        GROUP BY n.n
      ) k;

  ELSIF p_group = 'content' THEN
    v_keys := ARRAY['posts.new', 'activities.new', 'workouts.new'];
    INSERT INTO tmp_rollup SELECT 'posts.new', '', count(*) FROM posts WHERE created_at >= v_start AND created_at < v_end;
    INSERT INTO tmp_rollup SELECT 'posts.new', 'status:' || status, count(*) FROM posts WHERE created_at >= v_start AND created_at < v_end GROUP BY 2;
    INSERT INTO tmp_rollup SELECT 'activities.new', '', count(*) FROM activities WHERE created_at >= v_start AND created_at < v_end;
    INSERT INTO tmp_rollup SELECT 'activities.new', 'type:' || activity_type, count(*) FROM activities WHERE created_at >= v_start AND created_at < v_end GROUP BY 2;
    INSERT INTO tmp_rollup SELECT 'workouts.new', '', count(*) FROM workout_sessions WHERE created_at >= v_start AND created_at < v_end;
    INSERT INTO tmp_rollup SELECT 'workouts.new', 'status:completed', count(*) FROM workout_sessions WHERE created_at >= v_start AND created_at < v_end AND status = 'completed';

  ELSIF p_group = 'community' THEN
    v_keys := ARRAY['orgs.new', 'orgs.total', 'tickets.new', 'tickets.closed', 'tickets.open', 'contacts.new'];
    INSERT INTO tmp_rollup SELECT 'orgs.new', 'kind:' || kind, count(*) FROM organizations WHERE created_at >= v_start AND created_at < v_end GROUP BY 2;
    -- Orgs are few next to accounts: a grouped count holds; past a million it becomes an estimate.
    INSERT INTO tmp_rollup SELECT 'orgs.total', 'kind:' || kind, count(*) FROM organizations GROUP BY 2;
    INSERT INTO tmp_rollup SELECT 'tickets.new', '', count(*) FROM tickets WHERE created_at >= v_start AND created_at < v_end;
    INSERT INTO tmp_rollup SELECT 'tickets.new', 'type:' || type, count(*) FROM tickets WHERE created_at >= v_start AND created_at < v_end GROUP BY 2;
    INSERT INTO tmp_rollup SELECT 'tickets.closed', '', count(*) FROM tickets WHERE closed_at >= v_start AND closed_at < v_end;
    INSERT INTO tmp_rollup SELECT 'tickets.open', '', count(*) FROM tickets WHERE status IN ('new', 'in_review', 'waiting_on_user');
    INSERT INTO tmp_rollup SELECT 'contacts.new', 'source:' || source, count(*) FROM contacts WHERE created_at >= v_start AND created_at < v_end GROUP BY 2;

  ELSIF p_group = 'totals' THEN
    v_keys := ARRAY['total'];
    INSERT INTO tmp_rollup SELECT 'total', 'table:' || e.relname, e.reltuples FROM platform_table_estimates() e;

  ELSIF p_group = 'storage' THEN
    v_keys := ARRAY['storage.objects', 'storage.bytes'];
    IF p_partial THEN RETURN; END IF;
    INSERT INTO tmp_rollup SELECT 'storage.objects', 'bucket:' || b.bucket, b.objects FROM platform_storage_by_bucket() b;
    INSERT INTO tmp_rollup SELECT 'storage.bytes',   'bucket:' || b.bucket, b.bytes   FROM platform_storage_by_bucket() b;

  ELSIF p_group = 'site' THEN
    v_keys := ARRAY['site.views', 'site.visitors'];
    INSERT INTO tmp_rollup SELECT 'site.views', '', coalesce(sum(views), 0) FROM org_site_stats_daily WHERE day = p_day;
    INSERT INTO tmp_rollup SELECT 'site.visitors', '', coalesce(sum(visitors), 0) FROM org_site_stats_daily WHERE day = p_day;

  ELSE
    RAISE EXCEPTION 'platform_rollup_day: unknown group %', p_group;
  END IF;

  IF NOT p_partial THEN
    DELETE FROM platform_stats_daily d WHERE d.day = p_day AND d.metric = ANY (v_keys);
    INSERT INTO platform_stats_daily (day, metric, dim, value)
      SELECT p_day, t.metric, t.dim, t.value FROM tmp_rollup t;
  END IF;

  RETURN QUERY SELECT t.metric, t.dim, t.value FROM tmp_rollup t ORDER BY 1, 2;
END $$;
REVOKE EXECUTE ON FUNCTION public.platform_rollup_day(date, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_rollup_day(date, text, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (267, '267_platform_stats.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 267 APPLIED | 4 | 5 | true | <profiles count> | 267
SELECT '267 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
          AND table_name IN ('profile_seen', 'platform_stats_daily', 'platform_health_samples', 'platform_jobs')) AS tables_expect_4,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
          AND p.proname IN ('bump_profile_seen', 'platform_table_estimates', 'platform_cron_runs', 'platform_storage_by_bucket', 'platform_rollup_day')) AS functions_expect_5,
       (SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profile_seen_on_insert')) AS trigger_exists,
       (SELECT count(*) FROM public.profile_seen) AS seeded_rows_expect_profiles,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_267;
