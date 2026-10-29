-- 288 — the comment like gets a gate, in ONE call (the leftovers program
-- PR 3, Oct 28 2026). POST /api/comments/like had NO visibility gate at all
-- (the authz allowlist's "post visibility checked" was not true): anyone
-- signed in could like a comment on a draft, a hidden post, a private
-- stranger's post, or across a block — and the route made four reads and
-- writes in a row to do it.
--
--   comment_like_toggle(viewer, comment) → {"outcome": "not_found"}
--                                        | {"outcome": "liked" | "already_liked" | "unliked", "likes_count": n}
--
-- The gate is the parent post's: post_like_allowed(viewer, post) (287 — the
-- read gate minus blocks; Tom: "same as reading"); a comment that is not
-- published itself (moderation, 223) is not_found either. Then
-- remove-or-insert on comment_likes — 277's ±1 triggers and 190's
-- notify_comment_like fire on the row exactly as they did for the route's
-- own insert / delete — and the trigger-written post_comments.likes_count
-- read in the same transaction. The route maps the outcome onto its
-- unchanged wire shape ({ isLiked, likes_count }).
--
-- VOLATILE plpgsql, SECURITY INVOKER (service role caller; no privilege
-- lent — 256 / 282's writer style), search_path pinned, EXECUTE for
-- service_role only. Deploy order: MIGRATION FIRST (a pure addition; a route
-- ahead of it answers 503 `Like service updating`, no-store). Reversal: DROP.

CREATE OR REPLACE FUNCTION public.comment_like_toggle(p_viewer uuid, p_comment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_post_id uuid;
  v_status text;
  v_outcome text;
  v_count integer;
BEGIN
  SELECT c.post_id, c.status INTO v_post_id, v_status
  FROM public.post_comments c
  WHERE c.id = p_comment_id;
  IF NOT FOUND
     OR COALESCE(v_status, 'published') <> 'published'
     OR NOT public.post_like_allowed(p_viewer, v_post_id) THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  DELETE FROM public.comment_likes WHERE comment_id = p_comment_id AND profile_id = p_viewer;
  IF FOUND THEN
    v_outcome := 'unliked';
  ELSE
    INSERT INTO public.comment_likes (comment_id, profile_id) VALUES (p_comment_id, p_viewer)
    ON CONFLICT (comment_id, profile_id) DO NOTHING;
    v_outcome := CASE WHEN FOUND THEN 'liked' ELSE 'already_liked' END;
  END IF;

  -- The trigger's ±1 is visible here (same transaction); never count the rows.
  SELECT COALESCE(likes_count, 0) INTO v_count FROM public.post_comments WHERE id = p_comment_id;
  RETURN jsonb_build_object('outcome', v_outcome, 'likes_count', v_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.comment_like_toggle(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comment_like_toggle(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.comment_like_toggle(uuid, uuid) IS
  'The comment-like toggle in one call (288): the parent post''s gate (post_like_allowed, 287) + the comment published, remove-or-insert the viewer''s like, read the trigger-written likes_count — {outcome, likes_count}; POST /api/comments/like maps the outcome. service_role only.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (288, '288_comment_like_toggle.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 288 APPLIED | 1 | true | 288
SELECT '288 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'comment_like_toggle') AS function_expect_1,
       (public.comment_like_toggle('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-00000000dead') = '{"outcome": "not_found"}'::jsonb) AS unknown_comment_is_not_found_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_288;
