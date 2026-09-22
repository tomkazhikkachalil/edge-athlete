-- ============================================================================
-- 230: Round 3 (the scale cliffs) — feed_following(): the following lens's
--      page, joined in SQL (merges ALONE, after 229)
-- ============================================================================
-- The following feed did this per request: read EVERY accepted follow of
-- the viewer (capped at 2 000 — a viewer following more than that saw a
-- silently truncated feed), then `posts WHERE profile_id IN (…2 001 ids…)`,
-- then the page. The join belongs in the database. This function returns
-- ONE PAGE of post ids for the viewer's following lens — the viewer's own
-- posts and every accepted followee's — newest first with the id tiebreak
-- the feed's keyset uses, either after a cursor (created_at, id) or at an
-- offset (the legacy pagination), `p_limit` rows: the route overfetches by
-- one for hasMore, then hydrates the ids through its existing select.
--
-- Deliberately NO visibility rule here: an accepted follow of a private
-- profile SHOULD see that profile's posts in this lens, and unpublished
-- posts are visible to their own author — both are the route's per-post
-- privacy filter, unchanged. The function only answers "whose posts, in
-- what order, which page".
--
-- SECURITY INVOKER: the route calls it on the service-role client; the API
-- roles never do (EXECUTE revoked). STABLE — a read. Re-runnable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.feed_following(
  p_viewer     uuid,
  p_limit      integer,
  p_cursor_ts  timestamptz DEFAULT NULL,
  p_cursor_id  uuid        DEFAULT NULL,
  p_offset     integer     DEFAULT 0
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT p.id
    FROM public.posts p
   WHERE (p.profile_id = p_viewer
          OR EXISTS (SELECT 1 FROM public.follows f
                      WHERE f.follower_id = p_viewer
                        AND f.following_id = p.profile_id
                        AND f.status = 'accepted'))
     AND (p_cursor_ts IS NULL
          OR p.created_at < p_cursor_ts
          OR (p.created_at = p_cursor_ts AND p.id < p_cursor_id))
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT GREATEST(1, LEAST(p_limit, 101))
  OFFSET GREATEST(0, p_offset);
$$;

REVOKE EXECUTE ON FUNCTION public.feed_following(uuid, integer, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.feed_following(uuid, integer, timestamptz, uuid, integer) TO service_role;

COMMENT ON FUNCTION public.feed_following(uuid, integer, timestamptz, uuid, integer) IS
  '230: one page of post ids for the following lens (self + accepted followees), newest first with the id tiebreak; the route applies the privacy filter. Service-role only.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (230, '230_feed_following_rpc.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 230 APPLIED | true | false | 230
SELECT '230 APPLIED' AS result,
       has_function_privilege('service_role', 'public.feed_following(uuid, integer, timestamptz, uuid, integer)', 'EXECUTE') AS service_role_expect_true,
       has_function_privilege('authenticated', 'public.feed_following(uuid, integer, timestamptz, uuid, integer)', 'EXECUTE') AS authenticated_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_230;
