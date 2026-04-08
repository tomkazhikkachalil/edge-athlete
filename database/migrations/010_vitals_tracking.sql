-- ============================================================================
-- VITALS TRACKING — Long-term Athlete Development Record
-- ============================================================================
-- Purpose: Store physical performance metrics as an immutable time-series.
--          Every entry is a permanent historical record. No overwrites.
--          Entries are never updated or deleted by users — only appended.
--
-- Design principles:
--   - value: always NUMERIC (timed events stored in seconds for comparison)
--   - value_display: formatted string for UI ("4:32", "225 lbs")
--   - source: supports future integrations (Strava, Apple Health, Garmin)
--   - Visibility inherits from profiles.visibility (no per-entry override)
--
-- Run in Supabase SQL Editor after deploying this migration.
-- ============================================================================

-- Drop if exists from a partial/failed run, then recreate clean.
DROP TABLE IF EXISTS public.athlete_vitals CASCADE;

CREATE TABLE public.athlete_vitals (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id    UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  metric_key    TEXT         NOT NULL,  -- e.g. 'bench_press', '40_yard_dash'
  metric_category TEXT       NOT NULL,  -- 'strength' | 'speed' | 'conditioning' | 'body'
  metric_label  TEXT         NOT NULL,  -- human-readable label stored at entry time
  value         NUMERIC,               -- numeric (timed events = seconds, e.g. 272 for 4:32 mile)
  value_display TEXT,                  -- formatted for UI ("4:32", "225 lbs", "34 in")
  unit          TEXT         NOT NULL, -- display unit ("sec", "lbs", "in", "bpm", "%", "reps")
  notes         TEXT,
  source        TEXT         NOT NULL DEFAULT 'manual', -- future: 'strava' | 'apple_health' | 'garmin'
  recorded_at   DATE         NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_athlete_vitals_profile_id
  ON public.athlete_vitals(profile_id);

CREATE INDEX idx_athlete_vitals_profile_metric
  ON public.athlete_vitals(profile_id, metric_key);

CREATE INDEX idx_athlete_vitals_profile_date
  ON public.athlete_vitals(profile_id, recorded_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.athlete_vitals ENABLE ROW LEVEL SECURITY;

-- SELECT: owner can always view; others can view if profile is public
CREATE POLICY "Athletes can view own vitals"
  ON public.athlete_vitals FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = profile_id
        AND p.visibility = 'public'
    )
  );

-- INSERT: only the profile owner can add entries
CREATE POLICY "Athletes can insert own vitals"
  ON public.athlete_vitals FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()));

-- NOTE: No UPDATE policy — entries are immutable historical records.
-- NOTE: No DELETE policy — corrections handled via Supabase dashboard / admin.
