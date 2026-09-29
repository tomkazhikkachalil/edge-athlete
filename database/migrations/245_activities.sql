-- ============================================================================
-- 245: activities — runs, rides, hikes and other GPS activities imported from
--      a device file (.FIT / .GPX / .TCX); later from Strava, Google Health
--      and Garmin (additive; runs on BOTH staging and prod before the
--      server PR deploys)
-- ============================================================================
-- Tom (Sep 29 2026): athletes bring what their watch or app recorded. Phase 1
-- is file import — every device can export a file, no provider approvals —
-- and every later provider is an ADAPTER producing the same normalized shape
-- (src/lib/activities/), so this table never learns a provider's format.
-- This file is the program's ONLY DDL:
--
--   1. activities — ONE row per activity per athlete. An activity is NOT a
--      sport: activity_type is its own list (run … climb; the training →
--      post-category precedent), never a SportRegistry key, and nothing here
--      writes athlete_performances (the dataset's vocabulary is the sports'
--      stat schemas — a bridge is a later decision).
--        source / external_id  where it came from; UNIQUE per profile, so a
--                   re-import of the same file (or a provider's re-delivery)
--                   updates the row instead of adding a second.
--        totals     recomputed by the SERVER from the points (never the
--                   client's), a device total kept only when plausible.
--        route_preview  an encoded polyline of at most 200 points, stored
--                   ALREADY TRIMMED (the first and last ~200 m cut — Tom's
--                   privacy rule), so every reader of it is safe by default.
--        stream_path  the full stream (points, HR, elevation …), gzipped
--                   JSON in the private uploads bucket at
--                   activities/<profile_id>/<id>.json.gz — storage, not
--                   rows, so the table stays small at tens of millions.
--        post_id    the feed post, when the athlete chose "Share to feed".
--        only_me    the athlete's per-activity "Only me".
--      Posture A: RLS on, no policies, service role only — the projection
--      in src/lib/activities/visibility.ts IS the access rule (owner /
--      viewer with the route trimmed / a supervised athlete's viewer with no
--      route at all).
--   2. reserved_handles: 'activities' — /activities/[id], the activity page
--      (RESERVED_ROOT_SLUGS in the same PR).
--
-- The table is created EMPTY, so its indexes are inline (MIGRATIONS "Large-
-- table indexes"). FKs, the primary key and the unique are named ALTERs so
-- the schema parser sees them (live-schema.ts only reads named constraints).
--
-- REVERSAL: DROP TABLE public.activities; delete reserved_handles
-- 'activities'; remove the storage prefix activities/. Re-runnable until the
-- ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 245) THEN
    RAISE EXCEPTION '245 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 244 THEN RAISE EXCEPTION '245 pre-flight: ledger head is %, expected 244', n; END IF;
  -- The new root segment must be free before it is reserved.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(handle) = 'activities') THEN
    RAISE EXCEPTION '245 pre-flight: a profile already holds the handle "activities"';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_sites WHERE lower(subdomain) = 'activities') THEN
    RAISE EXCEPTION '245 pre-flight: an org site already holds the slug "activities"';
  END IF;
END $$;

-- ── 1. activities ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activities (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  profile_id     uuid        NOT NULL,
  activity_type  text        NOT NULL CONSTRAINT activities_activity_type_check
                             CHECK (activity_type IN ('run', 'trail_run', 'walk', 'hike', 'ride', 'mountain_bike',
                                                      'swim', 'row', 'ski', 'climb', 'other')),
  source         text        NOT NULL CONSTRAINT activities_source_check CHECK (source IN ('file')),
  source_format  text        CONSTRAINT activities_source_format_check
                             CHECK (source_format IS NULL OR source_format IN ('fit', 'gpx', 'tcx')),
  external_id    text        NOT NULL CONSTRAINT activities_external_id_check CHECK (length(external_id) BETWEEN 1 AND 200),
  name           text        NOT NULL CONSTRAINT activities_name_check CHECK (length(name) BETWEEN 1 AND 120),
  started_at     timestamptz NOT NULL,
  timezone       text        CONSTRAINT activities_timezone_check CHECK (timezone IS NULL OR length(timezone) BETWEEN 1 AND 64),
  occurred_on    date        NOT NULL,
  elapsed_s      integer     NOT NULL CONSTRAINT activities_elapsed_check CHECK (elapsed_s BETWEEN 0 AND 172800),
  moving_s       integer     CONSTRAINT activities_moving_check CHECK (moving_s IS NULL OR moving_s BETWEEN 0 AND 172800),
  distance_m     numeric     CONSTRAINT activities_distance_check CHECK (distance_m IS NULL OR distance_m BETWEEN 0 AND 2000000),
  elev_gain_m    numeric     CONSTRAINT activities_elev_gain_check CHECK (elev_gain_m IS NULL OR elev_gain_m BETWEEN 0 AND 30000),
  elev_loss_m    numeric     CONSTRAINT activities_elev_loss_check CHECK (elev_loss_m IS NULL OR elev_loss_m BETWEEN 0 AND 30000),
  avg_hr         smallint    CONSTRAINT activities_avg_hr_check CHECK (avg_hr IS NULL OR avg_hr BETWEEN 20 AND 250),
  max_hr         smallint    CONSTRAINT activities_max_hr_check CHECK (max_hr IS NULL OR max_hr BETWEEN 20 AND 250),
  avg_power      smallint    CONSTRAINT activities_avg_power_check CHECK (avg_power IS NULL OR avg_power BETWEEN 0 AND 2500),
  avg_cadence    smallint    CONSTRAINT activities_avg_cadence_check CHECK (avg_cadence IS NULL OR avg_cadence BETWEEN 0 AND 300),
  calories       integer     CONSTRAINT activities_calories_check CHECK (calories IS NULL OR calories BETWEEN 0 AND 50000),
  has_route      boolean     NOT NULL DEFAULT false,
  route_preview  text        CONSTRAINT activities_route_preview_check CHECK (route_preview IS NULL OR length(route_preview) <= 8000),
  stream_path    text        CONSTRAINT activities_stream_path_check
                             CHECK (stream_path IS NULL OR stream_path ~ '^activities/[0-9a-f-]{36}/[0-9a-f-]{36}\.json\.gz$'),
  post_id        uuid,
  only_me        boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  -- A route preview only exists on an activity with a route.
  CONSTRAINT activities_route_parts_check CHECK (has_route OR route_preview IS NULL)
);
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_pkey;
ALTER TABLE public.activities ADD CONSTRAINT activities_pkey PRIMARY KEY (id);
-- The dedupe key; profile_id leads, so it is also the FK's index.
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_source_uniq;
ALTER TABLE public.activities ADD CONSTRAINT activities_source_uniq UNIQUE (profile_id, source, external_id);
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_profile_id_fkey;
ALTER TABLE public.activities ADD CONSTRAINT activities_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_post_id_fkey;
ALTER TABLE public.activities ADD CONSTRAINT activities_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE SET NULL;
-- The profile tab and the weekly totals: newest first per athlete.
CREATE INDEX IF NOT EXISTS idx_activities_profile_started ON public.activities (profile_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_post ON public.activities (post_id) WHERE post_id IS NOT NULL;
DROP TRIGGER IF EXISTS activities_updated_at ON public.activities;
CREATE TRIGGER activities_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activities FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.activities IS 'Imported GPS activities (245): one row per activity per athlete; not a sport. ONE writer: src/lib/activities/write-server.ts. The projection in src/lib/activities/visibility.ts is the access rule. Posture A.';

-- ── 2. The new root segment ─────────────────────────────────────────────────
INSERT INTO reserved_handles (handle, reason)
VALUES ('activities', 'Root path (vanity namespace, 245): /activities/[id], the activity page')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (245, '245_activities.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 245 APPLIED | 1 | 1 | 0 | 1 | 245
SELECT '245 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activities') AS table_expect_1,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'activities' AND c.relrowsecurity) AS rls_on_expect_1,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activities') AS policies_expect_0,
       (SELECT count(*) FROM reserved_handles WHERE handle = 'activities') AS reserved_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_245;
