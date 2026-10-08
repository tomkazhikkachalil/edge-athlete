-- ============================================================================
-- 255: the proactive course-map sweep — its cells, its claim, its schedule
--      (Golf map sweep program PR 6, Oct 8 2026; runs on BOTH staging and
--      prod; additive)
-- ============================================================================
-- Tom: "ensure we have all the courses possibly mapped as much as we can —
-- not the lazy route." The hole geometry (102) and the elevation profile
-- (254) were fetched LAZILY, one course at a time on its first map open:
-- 128 of 28,988 courses had ever been asked. The sweep walks the world by
-- 0.5° cells — one regional Overpass answer per cell, every course in it
-- through the same pipeline the lazy path runs — and keeps them fresh.
--
--   golf_map_sweep_cells  one row per 0.5° box that holds catalog courses:
--                         the planner's columns (tier, priority, courses,
--                         rounds), the state machine (status, attempts,
--                         leased_until, next_due_at), the metrics of the
--                         last success.
--   golf_map_sweep_meta   mirror cooldowns, the last run, the plan stamp.
--   golf_map_sweep_claim(n, lease)   FOR UPDATE SKIP LOCKED + a lease —
--                         the pg_cron tick and the dashboard's "run until
--                         done" loop may overlap; a crashed run's lease
--                         expires and the cell is picked up again.
--   golf_map_sweep_elevation_due(limit)  the elevationFresh() predicate in
--                         SQL (a column comparison PostgREST cannot express).
--   the one-off DELETE    four leaked qa-e2e course rows on production (the
--                         spec's finally used to close the browser first).
--   the pg_cron job       every 2 minutes → POST /api/cron/golf-map-sweep,
--                         only where urgent-emails already runs (248's
--                         detector — staging schedules nothing, by decision).
--
-- Both tables are posture A: RLS on, zero policies, service_role only.
-- The partial index on golf_courses(hole_elevation_at) is built inline:
-- golf_courses holds 29k rows, a plain CREATE INDEX is sub-second there,
-- and the ledger test counts every NNN_*.sql as a chain member (the
-- two-file CONCURRENTLY shape MIGRATIONS.md describes has never shipped).
-- Pre-flight: ledger head 254. Deploy order: FLEXIBLE — the routes answer
-- 409 while the tables are missing. Reversal (data-safe): unschedule the
-- job, drop the two functions and the two tables.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 255) THEN
    RAISE EXCEPTION '255 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 254 THEN RAISE EXCEPTION '255 pre-flight: ledger head is %, expected 254', n; END IF;
END $$;

-- ── 1. The cells ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.golf_map_sweep_cells (
  cell_key         text PRIMARY KEY,
  lat0             double precision NOT NULL,
  lng0             double precision NOT NULL,
  size_deg         double precision NOT NULL DEFAULT 0.5,
  tier             smallint NOT NULL DEFAULT 3 CHECK (tier BETWEEN 0 AND 3),
  priority         integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done')),
  attempts         integer NOT NULL DEFAULT 0,
  leased_until     timestamptz,
  next_due_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  attempted_at     timestamptz,
  planned_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  courses          integer NOT NULL DEFAULT 0,
  rounds           integer NOT NULL DEFAULT 0,
  attempted        integer NOT NULL DEFAULT 0,
  mapped           integer NOT NULL DEFAULT 0,
  with_greens      integer NOT NULL DEFAULT 0,
  sections         integer NOT NULL DEFAULT 0,
  derived          integer NOT NULL DEFAULT 0,
  greens_only      integer NOT NULL DEFAULT 0,
  null_no_coverage integer NOT NULL DEFAULT 0,
  refused          jsonb NOT NULL DEFAULT '{}'::jsonb,
  elements         integer,
  duration_ms      integer,
  mirror           text,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_golf_map_sweep_cells_due ON public.golf_map_sweep_cells (next_due_at, priority);
DROP TRIGGER IF EXISTS golf_map_sweep_cells_updated_at ON public.golf_map_sweep_cells;
CREATE TRIGGER golf_map_sweep_cells_updated_at
  BEFORE UPDATE ON public.golf_map_sweep_cells
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.golf_map_sweep_cells ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.golf_map_sweep_cells FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.golf_map_sweep_cells TO service_role;
COMMENT ON TABLE public.golf_map_sweep_cells IS 'The course-map sweep''s cells (255): one row per 0.5° box holding catalog courses; the planner''s tier / priority / courses / rounds, the state machine (status, attempts, leased_until, next_due_at) and the last success''s metrics. Service role only; written by src/lib/golf/map-sweep-server.ts.';

-- ── 2. The meta ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.golf_map_sweep_meta (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.golf_map_sweep_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.golf_map_sweep_meta FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.golf_map_sweep_meta TO service_role;
COMMENT ON TABLE public.golf_map_sweep_meta IS 'The course-map sweep''s meta (255): mirror cooldowns, the last run, the plan stamp. Service role only.';

-- ── 3. The claim ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.golf_map_sweep_claim(integer, integer);
CREATE FUNCTION public.golf_map_sweep_claim(p_n integer, p_lease_seconds integer)
RETURNS SETOF public.golf_map_sweep_cells
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT cell_key FROM public.golf_map_sweep_cells
     WHERE next_due_at <= timezone('utc'::text, now())
       AND (status <> 'running' OR leased_until IS NULL OR leased_until < timezone('utc'::text, now()))
     ORDER BY priority, cell_key
     LIMIT GREATEST(p_n, 0)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.golf_map_sweep_cells c
     SET status = 'running',
         leased_until = timezone('utc'::text, now()) + make_interval(secs => GREATEST(p_lease_seconds, 1))
    FROM picked
   WHERE c.cell_key = picked.cell_key
  RETURNING c.*;
$$;
REVOKE EXECUTE ON FUNCTION public.golf_map_sweep_claim(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.golf_map_sweep_claim(integer, integer) TO service_role;
COMMENT ON FUNCTION public.golf_map_sweep_claim IS 'Claim up to n due cells for one sweep invocation (255): FOR UPDATE SKIP LOCKED plus a lease, so the cron tick and the dashboard loop never work the same cell twice.';

-- ── 4. Elevation due ────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.golf_map_sweep_elevation_due(integer);
CREATE FUNCTION public.golf_map_sweep_elevation_due(p_limit integer)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id FROM public.golf_courses c
   WHERE c.hole_geometry IS NOT NULL
     AND c.external_source <> 'qa-e2e'
     AND (c.hole_elevation_at IS NULL
          OR c.hole_elevation_at < c.hole_geometry_at
          OR c.hole_elevation_at < timezone('utc'::text, now()) - interval '30 days')
   ORDER BY c.hole_elevation_at NULLS FIRST, c.id
   LIMIT GREATEST(p_limit, 0);
$$;
REVOKE EXECUTE ON FUNCTION public.golf_map_sweep_elevation_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.golf_map_sweep_elevation_due(integer) TO service_role;
COMMENT ON FUNCTION public.golf_map_sweep_elevation_due IS 'Courses whose elevation profile is missing, older than their geometry or past 30 days (255) — elevation-server.ts elevationFresh() in SQL.';

-- ── 4b. The elevation phase's index (29k rows — sub-second, inline) ─────────
CREATE INDEX IF NOT EXISTS idx_golf_courses_elevation_due
  ON public.golf_courses (hole_elevation_at)
  WHERE hole_geometry IS NOT NULL;

-- ── 5. The leaked QA rows (every FK onto golf_courses is SET NULL) ──────────
DO $$
DECLARE n int;
BEGIN
  DELETE FROM public.golf_courses
   WHERE external_source = 'qa-e2e' AND created_at < timezone('utc'::text, now()) - interval '1 hour';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '255: % leaked qa-e2e course row(s) removed', n;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── 6. The schedule (only where urgent-emails already runs) ─────────────────
DO $job$
DECLARE
  auth_header text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT substring(command FROM 'Bearer [^'']+') INTO auth_header
      FROM cron.job WHERE jobname = 'urgent-emails' AND active LIMIT 1;
    IF auth_header IS NULL OR auth_header LIKE '%__CRON_SECRET__%' THEN
      RAISE NOTICE '255: no live urgent-emails job here — golf-map-sweep NOT scheduled (expected on staging)';
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'golf-map-sweep') THEN
        PERFORM cron.unschedule('golf-map-sweep');
      END IF;
      PERFORM cron.schedule('golf-map-sweep', '*/2 * * * *', format($cmd$
        SELECT net.http_post(
          url := 'https://edgeathlete.ca/api/cron/golf-map-sweep',
          headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'),
          body := '{}'::jsonb,
          timeout_milliseconds := 55000
        )
      $cmd$, auth_header));
      RAISE NOTICE '255: golf-map-sweep scheduled (every 2 minutes)';
    END IF;
  ELSE
    RAISE NOTICE '255: pg_cron/pg_net not installed here — golf-map-sweep NOT scheduled';
  END IF;
END $job$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (255, '255_golf_map_sweep.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on production: 255 APPLIED | 2 | 2 | 0 | 2 | 0 | 1 | 255
-- (staging: the job column reads 0 — no pg_cron jobs there, by decision)
SELECT '255 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('golf_map_sweep_cells', 'golf_map_sweep_meta')) AS tables_expect_2,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('golf_map_sweep_cells', 'golf_map_sweep_meta') AND rowsecurity) AS rls_on_expect_2,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('golf_map_sweep_cells', 'golf_map_sweep_meta')) AS policies_expect_0,
       (SELECT count(*) FROM pg_proc WHERE proname IN ('golf_map_sweep_claim', 'golf_map_sweep_elevation_due')) AS fns_expect_2,
       (SELECT count(*) FROM public.golf_courses WHERE external_source = 'qa-e2e' AND created_at < timezone('utc'::text, now()) - interval '1 hour') AS qa_e2e_left_expect_0,
       (SELECT count(*) FROM cron.job WHERE jobname = 'golf-map-sweep') AS cron_job_prod_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_255;
