-- ============================================================================
-- 199: CLEANUP — what the baselines recorded as redundant, removed
--      (hygiene sweep, H4 — Sep 16 2026)
-- ============================================================================
-- The baselines 190–198 recorded production exactly as they found it and
-- named, in their headers, what a later migration should decide. This is
-- that migration. Every drop below is backed by a body-by-body comparison
-- of the Sep 14 2026 catalog (database/provenance/dumps/2026-09-14-catalog
-- .json) and a caller search of src/ and e2e/; fifteen of the sixteen are
-- behaviour-neutral by construction, the sixteenth is made neutral by a
-- FOLD that runs first. Tom's decisions (Sep 15): fold, and revoke the
-- API-role EXECUTE on the SECURITY DEFINER trigger functions the chain
-- never locked.
--
-- 1. golf_hole_scores — DROP golf_hole_scores_{insert,update,delete}_policy:
--    byte-identical to the chain-owned hole_scores_* set (004 → 063 / 126).
--    hole_scores_select_policy is the table's ONLY select policy — kept.
-- 2. golf_participant_scores — THE FOLD, before any drop on the table:
--    golf_scores_update_policy (chain-owned, participant-only) is recreated
--    with BOTH branches, participant OR group-post creator — the creator
--    branch lived only in the archived participant_scores_update_policy,
--    and calculate_golf_participant_totals() (SECURITY INVOKER, 039) needs
--    it to write a creator-entered player's totals. The OR of the table's
--    UPDATE policies is unchanged. Then DROP golf_participant_scores_
--    {insert,update}_policy (identical to golf_scores_*),
--    participant_scores_select_policy (implied by golf_scores_select_policy,
--    a SECURITY DEFINER helper that ignores group_posts RLS),
--    participant_scores_insert_policy (narrower on the creator axis, wider
--    only for entered_by ≠ auth.uid() — both app insert sites set
--    entered_by = user.id: api/golf/participant-scores/route.ts,
--    api/golf/scorecards/[id]/scores/route.ts), and
--    participant_scores_update_policy (now folded).
-- 3. golf_scorecard_data — DROP golf_scorecard_data_{select,insert,update}_
--    policy and scorecard_{select,insert,update}_policy: all logically
--    identical to the chain-owned golf_data_* set (004 → 126); scorecard_*
--    only differed by a bare auth.uid() and an equivalent correlation.
-- 4. post_comments / post_likes — DROP update_post_comments_count_trigger
--    (a strict subset of trigger_update_post_comments_count, 095's shape
--    with UPDATE OF status) and update_post_likes_count_trigger (an
--    identical twin of trigger_update_post_likes_count). Both functions are
--    idempotent recounts; the counts never doubled, only the work did.
-- 5. group_posts — DROP trigger_group_posts_updated_at (recorded by 198):
--    the chain's trigger_update_group_post_timestamp sets updated_at on
--    the same event and, firing second in name order, already wins.
-- 6. mark_all_notifications_read() and (uuid) — DROP both: no caller in
--    src/, e2e/ or scripts/ (086 recorded "NO app caller" in 2026; the
--    notification routes UPDATE rows directly); service-role only; the
--    (uuid) overload has never worked (read / recipient_id — 42703 on the
--    live notifications table, 083's finding).
-- 7. REVOKE EXECUTE from PUBLIC, anon, authenticated on the SECURITY
--    DEFINER trigger functions still executable by API roles:
--    handle_updated_at(), update_post_reposts_count(),
--    consent_records_forbid_mutation() (never revoked) and
--    notify_post_comment() (040 revoked it; 095's DROP + CREATE reset it).
--    Trigger firing does not check EXECUTE — 040's thirteen have fired for
--    a year. is_conversation_participant() is NOT touched: an RLS helper
--    evaluates as the invoking role and must stay executable.
-- 8. DROP TABLE athlete_badges — never held a row (reltuples -1), delete-
--    only in the app since August 2026; the storage-sweep scan entry and
--    the account-deletion line were removed and DEPLOYED first (H3), so
--    the nightly sweep cannot 42P01 on it. Takes its 2 constraints, 2
--    indexes, 4 policies and 1 trigger with it.
--
-- NOT taken, recorded for a product decision: golf_hole_scores' UPDATE
-- policy is participant-only in both sets, so a creator RE-submitting
-- another player's scorecard hits 42501 on the upsert's ON CONFLICT DO
-- UPDATE (api/golf/participant-scores and scorecards/[id]/scores). A real
-- bug, one predicate wide; not a cleanup.
--
-- After this file: 107 tables · 172 policies · 105 functions · 97 non-
-- internal triggers; npm run check:schema OK on five facets, allowlist
-- EMPTY. Re-runnable (every statement IF EXISTS or a recreate).
-- ============================================================================

-- ── 2. The fold — before any drop on golf_participant_scores ─────────────────
DROP POLICY IF EXISTS golf_scores_update_policy ON public.golf_participant_scores;
CREATE POLICY golf_scores_update_policy ON public.golf_participant_scores FOR UPDATE
  USING (EXISTS (SELECT 1
                   FROM group_post_participants gpp
                  WHERE gpp.id = golf_participant_scores.participant_id
                    AND (gpp.profile_id = (SELECT auth.uid())
                         OR EXISTS (SELECT 1 FROM group_posts
                                     WHERE id = gpp.group_post_id
                                       AND creator_id = (SELECT auth.uid())))));

-- ── 1–3. The redundant policy sets ───────────────────────────────────────────
DROP POLICY IF EXISTS golf_hole_scores_insert_policy ON public.golf_hole_scores;
DROP POLICY IF EXISTS golf_hole_scores_update_policy ON public.golf_hole_scores;
DROP POLICY IF EXISTS golf_hole_scores_delete_policy ON public.golf_hole_scores;

DROP POLICY IF EXISTS golf_participant_scores_insert_policy ON public.golf_participant_scores;
DROP POLICY IF EXISTS golf_participant_scores_update_policy ON public.golf_participant_scores;
DROP POLICY IF EXISTS participant_scores_select_policy ON public.golf_participant_scores;
DROP POLICY IF EXISTS participant_scores_insert_policy ON public.golf_participant_scores;
DROP POLICY IF EXISTS participant_scores_update_policy ON public.golf_participant_scores;

DROP POLICY IF EXISTS golf_scorecard_data_select_policy ON public.golf_scorecard_data;
DROP POLICY IF EXISTS golf_scorecard_data_insert_policy ON public.golf_scorecard_data;
DROP POLICY IF EXISTS golf_scorecard_data_update_policy ON public.golf_scorecard_data;
DROP POLICY IF EXISTS scorecard_select_policy ON public.golf_scorecard_data;
DROP POLICY IF EXISTS scorecard_insert_policy ON public.golf_scorecard_data;
DROP POLICY IF EXISTS scorecard_update_policy ON public.golf_scorecard_data;

-- ── 4–5. The duplicate triggers ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_post_comments_count_trigger ON public.post_comments;
DROP TRIGGER IF EXISTS update_post_likes_count_trigger ON public.post_likes;
DROP TRIGGER IF EXISTS trigger_group_posts_updated_at ON public.group_posts;

-- ── 6. The overload pair nothing calls ───────────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_all_notifications_read();
DROP FUNCTION IF EXISTS public.mark_all_notifications_read(uuid);

-- ── 7. SECURITY DEFINER trigger functions: API roles need no EXECUTE ─────────
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_post_reposts_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consent_records_forbid_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_post_comment() FROM PUBLIC, anon, authenticated;

-- ── 8. The table that never held a row ───────────────────────────────────────
DROP TABLE IF EXISTS public.athlete_badges;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'golf_hole_scores: policies' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores'

UNION ALL

SELECT 'golf_hole_scores: select policy kept', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'hole_scores_select_policy'

UNION ALL

SELECT 'golf_participant_scores: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores'

UNION ALL

SELECT 'golf_scores_update_policy: creator branch folded in', 'true',
       COALESCE((SELECT (qual LIKE '%creator_id%')::text FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'golf_participant_scores' AND policyname = 'golf_scores_update_policy'), '-'),
       CASE WHEN (SELECT qual LIKE '%creator_id%' FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'golf_participant_scores' AND policyname = 'golf_scores_update_policy')
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'golf_scorecard_data: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data'

UNION ALL

SELECT 'post_likes: triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_likes'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'post_comments: triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_comments'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'group_posts: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.group_posts'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'mark_all_notifications_read overloads', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'mark_all_notifications_read'

UNION ALL

SELECT 'trigger functions: anon cannot execute', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('handle_updated_at', 'update_post_reposts_count', 'consent_records_forbid_mutation', 'notify_post_comment')
   AND has_function_privilege('anon', oid, 'EXECUTE')

UNION ALL

SELECT 'is_conversation_participant: authenticated still can', 'true',
       has_function_privilege('authenticated', 'public.is_conversation_participant(uuid, uuid)', 'EXECUTE')::text,
       CASE WHEN has_function_privilege('authenticated', 'public.is_conversation_participant(uuid, uuid)', 'EXECUTE') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'athlete_badges gone', 'true', (to_regclass('public.athlete_badges') IS NULL)::text,
       CASE WHEN to_regclass('public.athlete_badges') IS NULL THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'public policies total', '172', count(*)::text,
       CASE WHEN count(*) = 172 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public'

UNION ALL

SELECT 'public non-extension functions', '105', count(*)::text,
       CASE WHEN count(*) = 105 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM pg_depend x WHERE x.classid = 'pg_proc'::regclass AND x.objid = p.oid AND x.deptype = 'e')

UNION ALL

SELECT 'public non-internal triggers', '97', count(*)::text,
       CASE WHEN count(*) = 97 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal

ORDER BY 1;
