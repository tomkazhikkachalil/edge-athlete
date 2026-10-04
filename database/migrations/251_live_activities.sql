-- ============================================================================
-- 251: live activities — a recorded source, every timed activity type,
--      segments, steps, notes, and a photo table (Live Activities program,
--      Oct 4 2026; runs on BOTH staging and prod; additive, zero data moves)
-- ============================================================================
-- Tom: "When I walk, it's recorded the same way as a workout … reps and sets.
-- Not 30 mins of one exercise." Walks, runs, rides, swims, rows and every
-- other timed activity are recorded LIVE from the phone into the Activities
-- pipeline (245) — not as a workout kind. This file is the program's ONLY
-- DDL after the 250 hotfix:
--
--   1. activities.source gains 'live' (the phone recorder; the catalog's
--      ACTIVITY_SOURCES mirrors it — the test pins the two).
--   2. activities.activity_type widens from 11 to 26 types in three groups
--      (Tom: a BROAD, grouped list): outdoor GPS types, indoor timer types
--      (distance entered at finish), duration-only types. Every existing
--      value stays valid; the catalog mirrors the list in this ORDER.
--   3. New columns: segments (jsonb, boundaries only — sprints, climbs,
--      intervals marked during or after; per-segment stats are computed from
--      the stream at read time like the splits, never stored), steps +
--      steps_source (an ESTIMATE from distance and stride on the web —
--      labelled "est."; 'device' arrives with the native apps), notes.
--   4. activity_media — photos / clips taken during a recording or added
--      after (modelled on 216 sport_event_media): posture A, service role
--      only; at_s is the offset into the recording, so the photo's pin on the
--      map is DERIVED from the viewer's (trimmed) stream at read time — no
--      second place to trim. UNIQUE (activity_id, media_url): a retried
--      attach never duplicates. The files live under posts/<owner>/ through
--      the one upload door; URL_SOURCE_COLUMNS gains the table in the same PR.
--
-- Pre-flight: ledger head 250; activities exists. Order of operations: the
-- code that writes 'live' / segments / activity_media ships AFTER this ran on
-- both environments (a select naming a missing column 404s the whole API).
-- Reversal (data-safe): DROP TABLE activity_media; DROP the four columns;
-- re-declare the two CHECKs as 247 / 245 had them.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 251) THEN
    RAISE EXCEPTION '251 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 250 THEN RAISE EXCEPTION '251 pre-flight: ledger head is %, expected 250', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activities') THEN
    RAISE EXCEPTION '251 pre-flight: activities (245) is missing';
  END IF;
END $$;

-- ── 1. activities.source: the phone recorder ────────────────────────────────
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_source_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_source_check
  CHECK (source IN ('file', 'upload_link', 'polar', 'wahoo', 'coros', 'suunto', 'garmin', 'google_health', 'live'));

-- ── 2. activities.activity_type: every timed activity, three groups ─────────
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN (
    -- outdoor, GPS
    'run', 'trail_run', 'walk', 'hike', 'ride', 'mountain_bike', 'open_water_swim', 'paddle', 'ski', 'xc_ski', 'snowboard', 'skate',
    -- indoor, a timer, distance entered at finish
    'swim', 'row', 'indoor_ride', 'treadmill', 'elliptical', 'stair_climber',
    -- duration only
    'yoga', 'pilates', 'stretch', 'hiit', 'martial_arts', 'dance', 'climb', 'other'));

-- ── 3. segments, steps, notes ───────────────────────────────────────────────
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS steps integer,
  ADD COLUMN IF NOT EXISTS steps_source text,
  ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_segments_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_segments_check
  CHECK (jsonb_typeof(segments) = 'array' AND jsonb_array_length(segments) <= 50);
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_steps_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_steps_check
  CHECK (steps IS NULL OR steps BETWEEN 0 AND 200000);
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_steps_source_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_steps_source_check
  CHECK (steps_source IS NULL OR steps_source IN ('estimated', 'device'));
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_steps_parts_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_steps_parts_check
  CHECK ((steps IS NULL) = (steps_source IS NULL));
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_notes_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_notes_check
  CHECK (notes IS NULL OR length(notes) <= 2000);
COMMENT ON COLUMN public.activities.segments IS 'Segments (251): [{id, kind sprint|climb|interval|recovery|lap, from_s, to_s, label?}] — boundaries only, ≤ 50, shape enforced in code (src/lib/activities/segments.ts); stats are computed from the stream at read time, never stored.';
COMMENT ON COLUMN public.activities.steps IS 'Steps (251): an ESTIMATE from distance and stride on the web (steps_source estimated, shown "est."); a device count arrives with the native apps.';
COMMENT ON COLUMN public.activities.notes IS 'The athlete''s notes (251), ≤ 2000 chars; public words — "Only me" hides the whole row.';

-- ── 4. activity_media ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_media (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id        uuid NOT NULL,
  profile_id         uuid NOT NULL,
  created_by_user_id uuid,
  media_url          text NOT NULL CONSTRAINT activity_media_url_check CHECK (length(btrim(media_url)) BETWEEN 1 AND 2000),
  media_type         text NOT NULL CONSTRAINT activity_media_type_check CHECK (media_type IN ('image', 'video')),
  thumbnail_url      text CONSTRAINT activity_media_thumb_check CHECK (thumbnail_url IS NULL OR length(thumbnail_url) BETWEEN 1 AND 2000),
  duration_seconds   numeric(8,2) CONSTRAINT activity_media_duration_check CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  caption            text CONSTRAINT activity_media_caption_check CHECK (caption IS NULL OR length(caption) <= 500),
  at_s               integer CONSTRAINT activity_media_at_check CHECK (at_s IS NULL OR at_s BETWEEN 0 AND 172800),
  display_order      smallint NOT NULL DEFAULT 0,
  mirrored_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.activity_media DROP CONSTRAINT IF EXISTS activity_media_pkey;
ALTER TABLE public.activity_media ADD CONSTRAINT activity_media_pkey PRIMARY KEY (id);
ALTER TABLE public.activity_media DROP CONSTRAINT IF EXISTS activity_media_activity_id_fkey;
ALTER TABLE public.activity_media ADD CONSTRAINT activity_media_activity_id_fkey
  FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;
ALTER TABLE public.activity_media DROP CONSTRAINT IF EXISTS activity_media_profile_id_fkey;
ALTER TABLE public.activity_media ADD CONSTRAINT activity_media_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.activity_media DROP CONSTRAINT IF EXISTS activity_media_created_by_user_id_fkey;
ALTER TABLE public.activity_media ADD CONSTRAINT activity_media_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
-- A retried attach never duplicates.
ALTER TABLE public.activity_media DROP CONSTRAINT IF EXISTS activity_media_activity_url_uniq;
ALTER TABLE public.activity_media ADD CONSTRAINT activity_media_activity_url_uniq UNIQUE (activity_id, media_url);
-- Every FK ships with an index whose leading column is its column (239's rule).
CREATE INDEX IF NOT EXISTS idx_activity_media_activity ON public.activity_media (activity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_media_profile ON public.activity_media (profile_id);
CREATE INDEX IF NOT EXISTS idx_activity_media_created_by ON public.activity_media (created_by_user_id);
ALTER TABLE public.activity_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_media FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.activity_media IS 'A photo / clip on an activity (251): taken during a recording or added after; posture A behind the activity gate (src/lib/activities/read-server.ts); at_s pins it to the route at READ time from the viewer''s trimmed stream; mirrored into the shared post (mirrored_at).';
COMMENT ON COLUMN public.activity_media.created_by_user_id IS 'The human author when a guardian acts for a supervised athlete (the 090 attribution); NULL for a self-upload.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (251, '251_live_activities.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on both environments: 251 APPLIED | 4 | 1 | 3 | true | 251
SELECT '251 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activities'
         AND column_name IN ('segments', 'steps', 'steps_source', 'notes')) AS new_columns_expect_4,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activity_media') AS media_table_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'activity_media' AND indexname LIKE 'idx_activity_media_%') AS media_indexes_expect_3,
       (SELECT pg_get_constraintdef(oid) LIKE '%''live''%' FROM pg_constraint WHERE conname = 'activities_source_check') AS live_source_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_251;
