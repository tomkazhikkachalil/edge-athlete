-- ============================================================================
-- Migration 063 — Public rounds: participants & scores visible to viewers;
--                 realtime re-asserted
-- ============================================================================
-- BUG (user-reported Aug 3, first real two-account live-round test): a signed-
-- in NON-PARTICIPANT watching a PUBLIC live round saw media but NO players and
-- NO scores — even on hard refresh — and nothing ever updated.
--
-- ROOT CAUSE: group_posts, golf_scorecard_data and group_post_media SELECT
-- policies all have a `visibility = 'public'` branch, but
--   • group_post_participants LOST its public branch in migration 035 (the
--     recursion rewrite claimed "semantics preserved exactly" — they weren't:
--     add-shared-golf-rounds.sql:280-295 — now in database/archive/loose-legacy/
--     — had the branch, 035 dropped it), and
--   • golf_participant_scores / golf_hole_scores NEVER had one.
-- PostgREST filters every embed independently, so the scorecard endpoint
-- returned 200 with full media and participants: [] for exactly the audience
-- live rounds exist for. Realtime applies the same subscriber SELECT policies,
-- so score events were silently dropped for those viewers too.
--
-- FIX HERE: restore/add the public branch on all three tables via SECURITY
-- DEFINER helpers (the 035 pattern — policies never trigger other policies,
-- no 42P17). Write policies are untouched. The publication block re-asserts
-- 038 (which itself re-asserted the never-verified 031).
--
-- NOTE: the app no longer depends on these SELECT policies for the scorecard
-- REST read — src/app/api/group-posts/[id]/scorecard/route.ts reads via the
-- admin client behind canViewSharedRound() (src/lib/golf/round-access.ts),
-- whose rule is an exact copy of can_view_group_post below. THIS migration is
-- what makes REALTIME score events reach non-participant viewers (instant
-- updates instead of the 60s poll). If either rule ever changes, change the
-- other in the same commit.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ⚠️ Order-independent with the code deploy — safe before or after.
-- Idempotent (CREATE OR REPLACE + DROP IF EXISTS + guarded publication adds).
-- ============================================================================

-- ── Helpers (SECURITY DEFINER = read tables without RLS; 035 conventions) ───

-- The three-branch visibility rule, one place: public OR creator OR
-- participant. Mirrors src/lib/golf/round-access.ts canViewSharedRound().
CREATE OR REPLACE FUNCTION public.can_view_group_post(gp_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_posts
    WHERE id = gp_id AND (visibility = 'public' OR creator_id = auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.group_post_participants
    WHERE group_post_id = gp_id AND profile_id = auth.uid()
  );
$$;

-- Row → round lookups so the score policies stay single-call and cycle-free.
CREATE OR REPLACE FUNCTION public.participant_group_post(p_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT group_post_id FROM public.group_post_participants WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.hole_score_group_post(gps_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT gpp.group_post_id
  FROM public.golf_participant_scores gps
  JOIN public.group_post_participants gpp ON gpp.id = gps.participant_id
  WHERE gps.id = gps_id;
$$;

REVOKE ALL ON FUNCTION public.can_view_group_post(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.participant_group_post(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hole_score_group_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_group_post(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.participant_group_post(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.hole_score_group_post(uuid) TO authenticated, anon;

-- ── group_post_participants: restore the public branch 035 dropped ──────────

DROP POLICY IF EXISTS participants_select_policy ON group_post_participants;
CREATE POLICY participants_select_policy ON group_post_participants
FOR SELECT USING (
  profile_id = (select auth.uid()) OR
  public.can_view_group_post(group_post_id)
);

-- ── golf_participant_scores ──────────────────────────────────────────────────
-- Policy NAMES differ across the historical RLS files (004/optimize vs
-- final-rls-fix); migration run-state is unknown, so drop BOTH variants.

DROP POLICY IF EXISTS golf_scores_select_policy ON golf_participant_scores;
DROP POLICY IF EXISTS golf_participant_scores_select_policy ON golf_participant_scores;
CREATE POLICY golf_scores_select_policy ON golf_participant_scores
FOR SELECT USING (
  public.can_view_group_post(public.participant_group_post(participant_id))
);

-- ── golf_hole_scores ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS hole_scores_select_policy ON golf_hole_scores;
DROP POLICY IF EXISTS golf_hole_scores_select_policy ON golf_hole_scores;
CREATE POLICY hole_scores_select_policy ON golf_hole_scores
FOR SELECT USING (
  public.can_view_group_post(public.hole_score_group_post(golf_participant_id))
);

-- ── Realtime publication: re-assert 038/031 (no verified-run record) ─────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['golf_participant_scores', 'group_posts'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── Verification (run after; SQL editor only) ────────────────────────────────
-- 1. Policies present (expect exactly one SELECT policy per table):
--   SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('group_post_participants','golf_participant_scores','golf_hole_scores')
--     AND cmd = 'SELECT';
--   → participants_select_policy / golf_scores_select_policy / hole_scores_select_policy
--
-- 2. Publication membership (settles 031/038's unverified state):
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime'
--     AND tablename IN ('golf_participant_scores','group_posts');
--   → expect BOTH rows.
