-- ============================================================================
-- Migration 043 — Athlete achievements
-- ============================================================================
-- Real achievements replace the "coming soon" Achievements tab: awards,
-- titles, and milestones with a date, optional sport, organization, and
-- placement — filterable by sport and year alongside the rest of the
-- profile timeline. Date-ordered (newest first); no manual ordering.
--
-- Access model mirrors athlete_vitals (010): owner sees all, everyone sees
-- rows on public profiles; follower access to private profiles is enforced
-- by the API layer (admin client + canViewProfile), RLS is defense-in-depth.
--
-- ⚠️ RUN BEFORE DEPLOYING (the Achievements tab + counts endpoint query the
--    table → 42P01 otherwise). Idempotent. Supabase SQL Editor; expect
--    green "Success".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.athlete_achievements (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title         TEXT         NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description   TEXT         CHECK (char_length(description) <= 1000),
  sport_key     TEXT,                  -- NULL = general (non-sport) achievement
  achieved_on   DATE         NOT NULL,
  organization  TEXT         CHECK (char_length(organization) <= 120),  -- e.g. 'USGA', 'NCAA'
  placement     TEXT         CHECK (char_length(placement) <= 60),      -- e.g. '1st Place', 'Finalist'
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_achievements_profile_date
  ON public.athlete_achievements(profile_id, achieved_on DESC);

-- Shared canonical trigger fn (see 036_restore_updated_at_trigger.sql)
DROP TRIGGER IF EXISTS set_athlete_achievements_updated_at ON public.athlete_achievements;
CREATE TRIGGER set_athlete_achievements_updated_at
  BEFORE UPDATE ON public.athlete_achievements
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE public.athlete_achievements ENABLE ROW LEVEL SECURITY;

-- SELECT: owner always; anyone when the profile is public
DROP POLICY IF EXISTS achievements_select_policy ON public.athlete_achievements;
CREATE POLICY achievements_select_policy ON public.athlete_achievements
  FOR SELECT USING (
    profile_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = athlete_achievements.profile_id
        AND p.visibility = 'public'
    )
  );

DROP POLICY IF EXISTS achievements_insert_policy ON public.athlete_achievements;
CREATE POLICY achievements_insert_policy ON public.athlete_achievements
  FOR INSERT WITH CHECK (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS achievements_update_policy ON public.athlete_achievements;
CREATE POLICY achievements_update_policy ON public.athlete_achievements
  FOR UPDATE USING (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS achievements_delete_policy ON public.athlete_achievements;
CREATE POLICY achievements_delete_policy ON public.athlete_achievements
  FOR DELETE USING (profile_id = (SELECT auth.uid()));

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name = 'athlete_achievements';                       → 1 row
-- SELECT COUNT(*) FROM pg_policies
--  WHERE tablename = 'athlete_achievements';                        → 4
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'public.athlete_achievements'::regclass
--    AND NOT tgisinternal;                                          → 1 row
