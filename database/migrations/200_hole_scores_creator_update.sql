-- ============================================================================
-- 200: golf_hole_scores — the creator may UPDATE, as they may INSERT and DELETE
--      (bug fix — Sep 16 2026)
-- ============================================================================
-- Four RLS policies guard golf_hole_scores. INSERT (hole_scores_insert_policy)
-- and DELETE (hole_scores_delete_policy) admit the participant OR the
-- group-post creator; UPDATE (hole_scores_update_policy) admitted the
-- participant only. Migration 004 wrote it that way ("Participant can update
-- their own hole scores"); 126 re-wrapped auth.uid() as an initplan and
-- explicitly changed no semantics; nothing since touched it. The app has
-- always let a creator enter another player's scores — both routes gate on
-- it (api/golf/participant-scores: "only allow creator to enter scores for
-- others"; api/golf/scorecards/[id]/scores: "only the participant or group
-- post creator") — and then UPSERT through the user's session client:
-- INSERT … ON CONFLICT (golf_participant_id, hole_number) DO UPDATE, which
-- needs BOTH the INSERT check and the UPDATE check to pass. A creator's
-- FIRST entry for a player is a pure INSERT and works; any RE-submit — the
-- shared-round card's creator-only "Edit" on an already-scored player, the
-- live page's pre-filled modal, the composer's own "re-enter them from the
-- post" advice after a partial save — hit 42501. The bulk route reported it
-- as a 200 with failures[], the per-participant route as a generic 500, so
-- it never surfaced as an error a person could read. The provenance sweep's
-- policy analysis (199's header) found it.
--
-- The fix: hole_scores_update_policy gets the INSERT policy's predicate
-- verbatim, so INSERT WITH CHECK, UPDATE USING and DELETE USING are ONE
-- predicate — participant or creator. USING only (no WITH CHECK), the
-- table's existing shape and 199's fold on golf_participant_scores. That
-- fold is what makes this complete: the totals trigger
-- calculate_golf_participant_totals() is SECURITY INVOKER and updates
-- golf_participant_scores as the caller; 199 gave the creator that UPDATE
-- right, so once the hole-score UPDATE is permitted the recompute runs for
-- a creator too. No app code changes.
--
-- Behaviour change, on purpose: a group-post creator can now change a
-- player's already-entered hole scores (which the UI has offered all
-- along). The participant's own right is unchanged. Re-runnable (DROP IF
-- EXISTS + CREATE); the policy count on the table stays 4.
-- ============================================================================

DROP POLICY IF EXISTS hole_scores_update_policy ON public.golf_hole_scores;
CREATE POLICY hole_scores_update_policy ON public.golf_hole_scores
  FOR UPDATE
  USING (EXISTS (SELECT 1
                   FROM golf_participant_scores gps
                   JOIN group_post_participants gpp ON gps.participant_id = gpp.id
                   JOIN group_posts gp ON gpp.group_post_id = gp.id
                  WHERE gps.id = golf_hole_scores.golf_participant_id
                    AND (gpp.profile_id = (SELECT auth.uid())
                         OR gp.creator_id = (SELECT auth.uid()))));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'golf_hole_scores: policies' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores'

UNION ALL

SELECT 'hole_scores_update_policy: creator branch', 'true',
       COALESCE((SELECT (qual LIKE '%creator_id%')::text FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_update_policy'), '-'),
       CASE WHEN (SELECT qual LIKE '%creator_id%' FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_update_policy')
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'hole_scores_insert_policy: unchanged (creator branch)', 'true',
       COALESCE((SELECT (with_check LIKE '%creator_id%')::text FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_insert_policy'), '-'),
       CASE WHEN (SELECT with_check LIKE '%creator_id%' FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_insert_policy')
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'public policies total', '172', count(*)::text,
       CASE WHEN count(*) = 172 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public'

ORDER BY 1;
