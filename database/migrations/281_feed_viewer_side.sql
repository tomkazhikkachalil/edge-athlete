-- 281 — the viewer's side of a feed page in ONE call (trip-count program PR 2,
-- Oct 27 2026 — docs/SCALE_AUDIT.md §7: GET /api/posts made 8 database trips
-- a page; six of them only decided what the viewer may see and what they
-- already did: user_mutes, user_blocks ×2 (hiddenAuthorsFor, src/lib/mutes.ts),
-- follows for the page's authors, saved_posts and post_likes for the page).
--
-- Two functions, raw ids only — every rule stays in TypeScript (the privacy
-- filter, the own-post arm, the quoted-post gate, the per-post saved_posts /
-- likes arrays). The posts page itself stays the route's PostgREST select.
--
--   hidden_authors_for(viewer)            muted ∪ blocked ∪ blockers (the three
--                                         reads of hiddenAuthorsFor, each with
--                                         today's 2,000 cap) — used by every caller
--   feed_viewer_side(viewer, authors, posts)  { hidden, following, saved, liked }
--
-- STABLE, SECURITY INVOKER (the caller is the service role; no privilege is
-- lent), search_path pinned, EXECUTE for service_role only. Deploy order:
-- MIGRATION FIRST (pure additions; hiddenAuthorsFor falls back to its three
-- reads on PGRST202, the feed answers 503 `Feed service updating`, no-store,
-- while feed_viewer_side is missing). Reversal: DROP both.

CREATE OR REPLACE FUNCTION public.hidden_authors_for(p_viewer uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT x.id), '{}')
  FROM (
    SELECT m.muted_id AS id FROM (SELECT muted_id FROM public.user_mutes WHERE muter_id = p_viewer LIMIT 2000) m
    UNION ALL
    SELECT b.blocked_id FROM (SELECT blocked_id FROM public.user_blocks WHERE blocker_id = p_viewer LIMIT 2000) b
    UNION ALL
    SELECT c.blocker_id FROM (SELECT blocker_id FROM public.user_blocks WHERE blocked_id = p_viewer LIMIT 2000) c
  ) x
  WHERE x.id IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.hidden_authors_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hidden_authors_for(uuid) TO service_role;
COMMENT ON FUNCTION public.hidden_authors_for(uuid) IS
  'The authors a viewer never sees: muted ∪ blocked ∪ blockers, each arm capped at 2,000 as hiddenAuthorsFor read them (281). service_role only; src/lib/mutes.ts is the caller.';

CREATE OR REPLACE FUNCTION public.feed_viewer_side(p_viewer uuid, p_author_ids uuid[], p_post_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'hidden',    to_jsonb(public.hidden_authors_for(p_viewer)),
    'following', COALESCE((SELECT jsonb_agg(DISTINCT f.following_id) FROM public.follows f
                           WHERE f.follower_id = p_viewer AND f.status = 'accepted' AND f.following_id = ANY(p_author_ids)), '[]'::jsonb),
    'saved',     COALESCE((SELECT jsonb_agg(DISTINCT s.post_id) FROM public.saved_posts s
                           WHERE s.profile_id = p_viewer AND s.post_id = ANY(p_post_ids)), '[]'::jsonb),
    'liked',     COALESCE((SELECT jsonb_agg(DISTINCT l.post_id) FROM public.post_likes l
                           WHERE l.profile_id = p_viewer AND l.post_id = ANY(p_post_ids)), '[]'::jsonb)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.feed_viewer_side(uuid, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feed_viewer_side(uuid, uuid[], uuid[]) TO service_role;
COMMENT ON FUNCTION public.feed_viewer_side(uuid, uuid[], uuid[]) IS
  'One feed page''s viewer side (281): the hidden authors, the accepted followees among the page''s authors, the viewer''s saves and likes among the page''s posts — raw ids; GET /api/posts applies the rules. service_role only.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (281, '281_feed_viewer_side.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 281 APPLIED | 2 | true | 281
SELECT '281 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('hidden_authors_for', 'feed_viewer_side')) AS functions_expect_2,
       (public.feed_viewer_side('00000000-0000-4000-8000-000000000000', '{}', '{}') = '{"hidden": [], "following": [], "saved": [], "liked": []}'::jsonb) AS empty_shape_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_281;
