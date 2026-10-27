-- 282 — the like toggle is ONE call (trip-count program PR 3, Oct 27 2026 —
-- docs/SCALE_AUDIT.md §7: POST /api/posts/like made 7 database trips a tap;
-- five of them were the gate's post read, the conditional follow read, the
-- existing-like read, the insert or delete, and the likes_count read-back).
--
--   post_like_toggle(viewer, post) → {"outcome": "not_found"}
--                                  | {"outcome": "liked" | "already_liked" | "unliked", "likes_count": n}
--
-- The route's rules, verbatim: the post must exist; the viewer may like it
-- when they own it, or the post AND its owner are public, or they follow the
-- owner with an ACCEPTED follow (any other case is not_found — the route
-- answers the same 404 for a missing and a hidden post, so ids cannot be
-- probed). A like present is removed (unliked); otherwise one is inserted
-- (liked), and a concurrent insert that got there first reads already_liked
-- (the route's duplicate-key branch). The count is the trigger-written
-- column read inside the same transaction: 277's update_post_likes_count
-- (±1) and 190's notify_post_like fire on the row exactly as they do for the
-- route's own insert/delete — the toggle writes no counter and no bell.
--
-- VOLATILE plpgsql, SECURITY INVOKER (the caller is the service role, which
-- already writes post_likes; no privilege is lent — 256's writer style),
-- search_path pinned, EXECUTE for service_role only. Deploy order: MIGRATION
-- FIRST (a pure addition; a route ahead of it answers 503 `Like service
-- updating`, no-store, on PGRST202). Reversal: DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.post_like_toggle(p_viewer uuid, p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_post_visibility text;
  v_owner_visibility text;
  v_outcome text;
  v_count integer;
BEGIN
  SELECT p.profile_id, p.visibility, o.visibility
    INTO v_owner, v_post_visibility, v_owner_visibility
  FROM public.posts p
  LEFT JOIN public.profiles o ON o.id = p.profile_id
  WHERE p.id = p_post_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- The gate (src/app/api/posts/like/route.ts before 282): owner, or public
  -- post by a public owner, or an accepted follower. NULLs read as "not
  -- public", as the TypeScript comparison did.
  IF v_owner IS DISTINCT FROM p_viewer
     AND NOT (COALESCE(v_post_visibility, '') = 'public' AND COALESCE(v_owner_visibility, '') = 'public')
     AND NOT EXISTS (
       SELECT 1 FROM public.follows f
       WHERE f.follower_id = p_viewer AND f.following_id = v_owner AND f.status = 'accepted'
     )
  THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  DELETE FROM public.post_likes WHERE post_id = p_post_id AND profile_id = p_viewer;
  IF FOUND THEN
    v_outcome := 'unliked';
  ELSE
    INSERT INTO public.post_likes (post_id, profile_id) VALUES (p_post_id, p_viewer)
    ON CONFLICT (post_id, profile_id) DO NOTHING;
    v_outcome := CASE WHEN FOUND THEN 'liked' ELSE 'already_liked' END;
  END IF;

  -- The trigger's ±1 is visible here (same transaction); never count the rows.
  SELECT COALESCE(likes_count, 0) INTO v_count FROM public.posts WHERE id = p_post_id;
  RETURN jsonb_build_object('outcome', v_outcome, 'likes_count', v_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.post_like_toggle(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_like_toggle(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.post_like_toggle(uuid, uuid) IS
  'The like toggle in one call (282): the route''s visibility gate, remove-or-insert the viewer''s like, read the trigger-written likes_count — {outcome, likes_count}; POST /api/posts/like maps the outcome. service_role only.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (282, '282_post_like_toggle.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 282 APPLIED | 1 | true | 282
SELECT '282 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'post_like_toggle') AS function_expect_1,
       (public.post_like_toggle('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-00000000dead') = '{"outcome": "not_found"}'::jsonb) AS unknown_post_is_not_found_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_282;
