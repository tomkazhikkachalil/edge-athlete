-- ============================================================================
-- Migration 079 — Saved workout routines (presets)
-- ============================================================================
-- Named, reusable exercise lists a user saves from a finished workout (or
-- builds in Settings) and starts future sessions from. workout_routines (the
-- named preset) + workout_routine_exercises (ordered exercises with a planned
-- set count). Real tables, not a label column (contrast 064): routines exist
-- independently of any session, exercises are ordered, and each carries
-- metadata — none of which a label supports. Rows, not JSONB (045 precedent).
--
-- Copy-on-start: starting a session from a routine MATERIALIZES its exercises
-- into workout_exercises/workout_sets (target_sets empty set rows each). No FK
-- from sessions to routines — the entries PUT wholesale delete-reinserts
-- session children on every sync, so a shared row would be destroyed; copying
-- also makes preset immutability structural. Deleting a routine mid-session
-- is a no-op for the session.
--
-- Access model: OWNER-ONLY on both tables, all four operations. Unlike
-- sessions (public-select on public profiles), routines are private planning
-- data with no visitor-facing surface — deliberately no visibility branch.
--
-- ⚠️ RUN BEFORE DEPLOYING (the routines routes query these tables → 42P01
--    otherwise). Idempotent. Supabase SQL Editor.
-- ============================================================================

-- ── workout_routines ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workout_routines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_routines_profile_updated
  ON public.workout_routines(profile_id, updated_at DESC);
-- One "Push Day" per user; the API maps 23505 → 409 with a rename prompt
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_routines_profile_name
  ON public.workout_routines(profile_id, lower(name));

-- Shared canonical trigger fn (see 036_restore_updated_at_trigger.sql)
DROP TRIGGER IF EXISTS set_workout_routines_updated_at ON public.workout_routines;
CREATE TRIGGER set_workout_routines_updated_at
  BEFORE UPDATE ON public.workout_routines
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── workout_routine_exercises ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workout_routine_exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id   UUID NOT NULL REFERENCES public.workout_routines(id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, -- denormalized for RLS
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  exercise_key TEXT,          -- catalog key; NULL = custom exercise
  category     TEXT NOT NULL DEFAULT 'strength'
               CHECK (category IN ('strength','cardio','mobility','other')),
  position     INT NOT NULL DEFAULT 0,
  notes        TEXT CHECK (char_length(notes) <= 500),
  -- Planned set count: starting a session seeds this many EMPTY set rows
  target_sets  INT NOT NULL DEFAULT 3 CHECK (target_sets BETWEEN 1 AND 10),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_routine_exercises_routine
  ON public.workout_routine_exercises(routine_id, position);
CREATE INDEX IF NOT EXISTS idx_workout_routine_exercises_profile
  ON public.workout_routine_exercises(profile_id);

-- ── Row Level Security (owner-only — no public-visibility branch) ───────────
ALTER TABLE public.workout_routines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_routine_exercises ENABLE ROW LEVEL SECURITY;

-- workout_routines
DROP POLICY IF EXISTS workout_routines_select_policy ON public.workout_routines;
CREATE POLICY workout_routines_select_policy ON public.workout_routines
  FOR SELECT USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_routines_insert_policy ON public.workout_routines;
CREATE POLICY workout_routines_insert_policy ON public.workout_routines
  FOR INSERT WITH CHECK (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_routines_update_policy ON public.workout_routines;
CREATE POLICY workout_routines_update_policy ON public.workout_routines
  FOR UPDATE USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_routines_delete_policy ON public.workout_routines;
CREATE POLICY workout_routines_delete_policy ON public.workout_routines
  FOR DELETE USING (profile_id = (SELECT auth.uid()));

-- workout_routine_exercises
DROP POLICY IF EXISTS workout_routine_exercises_select_policy ON public.workout_routine_exercises;
CREATE POLICY workout_routine_exercises_select_policy ON public.workout_routine_exercises
  FOR SELECT USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_routine_exercises_insert_policy ON public.workout_routine_exercises;
CREATE POLICY workout_routine_exercises_insert_policy ON public.workout_routine_exercises
  FOR INSERT WITH CHECK (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_routine_exercises_update_policy ON public.workout_routine_exercises;
CREATE POLICY workout_routine_exercises_update_policy ON public.workout_routine_exercises
  FOR UPDATE USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS workout_routine_exercises_delete_policy ON public.workout_routine_exercises;
CREATE POLICY workout_routine_exercises_delete_policy ON public.workout_routine_exercises
  FOR DELETE USING (profile_id = (SELECT auth.uid()));

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('workout_routines','workout_routine_exercises');
--                                                                  → 2 rows
-- SELECT COUNT(*) FROM pg_policies
--  WHERE tablename IN ('workout_routines','workout_routine_exercises');
--                                                                  → 8
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'public.workout_routines'::regclass AND NOT tgisinternal;
--                                                                  → 1 row
-- SELECT indexname FROM pg_indexes
--  WHERE tablename LIKE 'workout_routine%' AND indexname LIKE 'idx_%';
--                                                                  → 4 rows
