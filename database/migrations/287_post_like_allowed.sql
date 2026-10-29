-- 287 — a like follows the read gate, minus blocks (the leftovers program
-- PR 2, Oct 28 2026 — Tom's decision). 282's gate let anyone who could see
-- the author like a post that was a DRAFT, hidden by a moderator, by a
-- departed account, or across a block in either direction. The rule now:
--
--   post_like_allowed(viewer, post) =
--     the owner, or a guardian (a profile_access row on the owner)
--     — always —
--     otherwise: the post is PUBLISHED, the owner has not departed, and
--     (post public AND owner public) OR an ACCEPTED follow of the owner;
--     and, for anyone but the owner, no block in either direction.
--
-- That is src/lib/posts/read-gate.ts (canReadPost) plus the block arm —
-- the same facts the single-post read uses. Mutes do NOT refuse (one-way;
-- the muter's feed hides the post anyway). A refusal is still `not_found`
-- → the route's 404: a missing, hidden or blocked post reads the same, so
-- ids cannot be probed.
--
-- post_like_toggle (282) is re-declared to call it; the toggle itself —
-- remove-or-insert, the trigger-written count — is unchanged. 288 will call
-- post_like_allowed for a comment's parent post too.
--
-- STABLE SECURITY INVOKER (service role caller; no privilege lent),
-- search_path pinned, EXECUTE for service_role only. Deploy order:
-- MIGRATION FIRST (CREATE OR REPLACE; the route is untouched). Reversal:
-- re-run 282's CREATE OR REPLACE and DROP post_like_allowed.

CREATE OR REPLACE FUNCTION public.post_like_allowed(p_viewer uuid, p_post_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.posts p
    JOIN public.profiles o ON o.id = p.profile_id
    WHERE p.id = p_post_id
      AND (
        p.profile_id = p_viewer
        OR EXISTS (SELECT 1 FROM public.profile_access a WHERE a.user_id = p_viewer AND a.profile_id = p.profile_id)
        OR (
          COALESCE(p.status, 'published') = 'published'
          AND o.departed_at IS NULL
          AND (
            (COALESCE(p.visibility, '') = 'public' AND COALESCE(o.visibility, '') = 'public')
            OR EXISTS (SELECT 1 FROM public.follows f
                       WHERE f.follower_id = p_viewer AND f.following_id = p.profile_id AND f.status = 'accepted')
          )
        )
      )
      AND (
        p.profile_id = p_viewer
        OR NOT EXISTS (SELECT 1 FROM public.user_blocks b
                       WHERE (b.blocker_id = p_viewer AND b.blocked_id = p.profile_id)
                          OR (b.blocker_id = p.profile_id AND b.blocked_id = p_viewer))
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.post_like_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_like_allowed(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.post_like_allowed(uuid, uuid) IS
  'May this viewer like this post (287): the read gate (owner / guardian always; else published, owner present, public+public or an accepted follow) minus blocks either way. service_role only.';

CREATE OR REPLACE FUNCTION public.post_like_toggle(p_viewer uuid, p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_outcome text;
  v_count integer;
BEGIN
  -- The gate (287): a missing, unpublished, departed-owner or blocked post
  -- all read not_found — the route's 404 — so ids cannot be probed.
  IF NOT public.post_like_allowed(p_viewer, p_post_id) THEN
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
  'The like toggle in one call (282, gate 287): post_like_allowed, remove-or-insert the viewer''s like, read the trigger-written likes_count — {outcome, likes_count}; POST /api/posts/like maps the outcome. service_role only.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (287, '287_post_like_allowed.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 287 APPLIED | 2 | true | 287
SELECT '287 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('post_like_allowed', 'post_like_toggle')) AS functions_expect_2,
       (NOT public.post_like_allowed('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-00000000dead')
        AND (public.post_like_toggle('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-00000000dead') = '{"outcome": "not_found"}'::jsonb)) AS unknown_post_refused_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_287;
