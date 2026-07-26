-- ============================================================================
-- Migration 045 — Edge Vitals workout tracking
-- ============================================================================
-- Live + back-logged workout sessions: workout_sessions (the session and its
-- lifecycle), workout_exercises (ordered exercises within a session), and
-- workout_sets (individual sets — reps/weight or time/distance). Rows, not
-- JSONB, so decades of training data stay queryable (golf_holes precedent).
--
-- Lifecycle: live sessions insert as status='active' and are finalized by
-- Finish (or lazily after 6h idle — no cron; the API finalizes stale actives
-- on the owner's next read). Back-logged workouts insert as 'completed'.
-- posts.stats_data carries a denormalized summary chip for shared workouts;
-- sessions.post_id links the share (SET NULL if the post is deleted).
--
-- Access model mirrors athlete_vitals (010): owner sees all, everyone sees
-- rows on public profiles; follower access to private profiles is enforced
-- by the API layer (admin client + gating), RLS is defense-in-depth.
-- Non-owners only ever receive completed sessions (API-enforced).
--
-- ⚠️ RUN BEFORE DEPLOYING (the Vitals tab + workout routes query these
--    tables → 42P01 otherwise). Idempotent. Supabase SQL Editor.
-- ============================================================================

-- ── workout_sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workout_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title            TEXT CHECK (char_length(title) <= 120),
  notes            TEXT CHECK (char_length(notes) <= 1000),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  source           TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live','manual')),
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  duration_seconds INT CHECK (duration_seconds >= 0),
  post_id          UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_profile_started
  ON public.workout_sessions(profile_id, started_at DESC);
-- Fast "is a workout in progress?" lookup for the resume banner / 409 check
CREATE INDEX IF NOT EXISTS idx_workout_sessions_active
  ON public.workout_sessions(profile_id) WHERE status = 'active';

-- Shared canonical trigger fn (see 036_restore_updated_at_trigger.sql)
DROP TRIGGER IF EXISTS set_workout_sessions_updated_at ON public.workout_sessions;
CREATE TRIGGER set_workout_sessions_updated_at
  BEFORE UPDATE ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── workout_exercises ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workout_exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES public.workout_sessions(id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, -- denormalized for RLS
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  exercise_key TEXT,          -- catalog key; NULL = custom exercise
  category     TEXT NOT NULL DEFAULT 'strength'
               CHECK (category IN ('strength','cardio','mobility','other')),
  position     INT NOT NULL DEFAULT 0,
  notes        TEXT CHECK (char_length(notes) <= 500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_session
  ON public.workout_exercises(session_id, position);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_profile
  ON public.workout_exercises(profile_id);

-- ── workout_sets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workout_sets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id      UUID NOT NULL REFERENCES public.workout_exercises(id) ON DELETE CASCADE,
  profile_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  set_number       INT NOT NULL CHECK (set_number BETWEEN 1 AND 99),
  reps             INT CHECK (reps BETWEEN 0 AND 1000),
  weight           NUMERIC CHECK (weight >= 0 AND weight <= 5000),
  weight_unit      TEXT CHECK (weight_unit IN ('lbs','kg')),
  duration_seconds INT CHECK (duration_seconds >= 0),
  distance         NUMERIC CHECK (distance >= 0),
  distance_unit    TEXT CHECK (distance_unit IN ('mi','km','m','yd')),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise
  ON public.workout_sets(exercise_id, set_number);
CREATE INDEX IF NOT EXISTS idx_workout_sets_profile
  ON public.workout_sets(profile_id);

-- ── Row Level Security (vitals/achievements pattern) ────────────────────────
ALTER TABLE public.workout_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sets      ENABLE ROW LEVEL SECURITY;

-- workout_sessions
DROP POLICY IF EXISTS workout_sessions_select_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_select_policy ON public.workout_sessions
  FOR SELECT USING (
    profile_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = workout_sessions.profile_id AND p.visibility = 'public')
  );
DROP POLICY IF EXISTS workout_sessions_insert_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_insert_policy ON public.workout_sessions
  FOR INSERT WITH CHECK (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_sessions_update_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_update_policy ON public.workout_sessions
  FOR UPDATE USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_sessions_delete_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_delete_policy ON public.workout_sessions
  FOR DELETE USING (profile_id = (SELECT auth.uid()));

-- workout_exercises
DROP POLICY IF EXISTS workout_exercises_select_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_select_policy ON public.workout_exercises
  FOR SELECT USING (
    profile_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = workout_exercises.profile_id AND p.visibility = 'public')
  );
DROP POLICY IF EXISTS workout_exercises_insert_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_insert_policy ON public.workout_exercises
  FOR INSERT WITH CHECK (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_exercises_update_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_update_policy ON public.workout_exercises
  FOR UPDATE USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_exercises_delete_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_delete_policy ON public.workout_exercises
  FOR DELETE USING (profile_id = (SELECT auth.uid()));

-- workout_sets
DROP POLICY IF EXISTS workout_sets_select_policy ON public.workout_sets;
CREATE POLICY workout_sets_select_policy ON public.workout_sets
  FOR SELECT USING (
    profile_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = workout_sets.profile_id AND p.visibility = 'public')
  );
DROP POLICY IF EXISTS workout_sets_insert_policy ON public.workout_sets;
CREATE POLICY workout_sets_insert_policy ON public.workout_sets
  FOR INSERT WITH CHECK (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_sets_update_policy ON public.workout_sets;
CREATE POLICY workout_sets_update_policy ON public.workout_sets
  FOR UPDATE USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_sets_delete_policy ON public.workout_sets;
CREATE POLICY workout_sets_delete_policy ON public.workout_sets
  FOR DELETE USING (profile_id = (SELECT auth.uid()));

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('workout_sessions','workout_exercises','workout_sets');
--                                                                  → 3 rows
-- SELECT COUNT(*) FROM pg_policies
--  WHERE tablename IN ('workout_sessions','workout_exercises','workout_sets');
--                                                                  → 12
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'public.workout_sessions'::regclass AND NOT tgisinternal;
--                                                                  → 1 row
-- SELECT indexname FROM pg_indexes
--  WHERE tablename LIKE 'workout_%' AND indexname LIKE 'idx_%';    → 6 rows
