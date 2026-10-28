-- 284 — the notifications page is ONE call (trip-count program PR 5, Oct 27
-- 2026 — docs/SCALE_AUDIT.md §7: GET /api/notifications made 6 database
-- trips a page, 4 since 281 made hiddenAuthorsFor one call: the session
-- check, the page read (with its actor embed), hidden_authors_for, and a
-- HEAD count of the unread rows).
--
--   notifications_bell_page(viewer, limit, cursor, unread_only, type)
--     → { rows, hidden, unread_count }
--
-- The route's page read verbatim — the viewer's rows, the optional unread /
-- type filters, the keyset `created_at < cursor`, newest first, LIMIT limit
-- + 1 (the extra row answers has_more) — with the actor embed rendered as
-- PostgREST renders an embed (jsonb inside a json row, so the bytes match);
-- the hidden actors (281's hidden_authors_for: muted ∪ blocked ∪ blockers);
-- the unread count. Raw rows and ids: the route still drops a hidden actor's
-- rows, slices the page, derives has_more and next_cursor, and shapes the
-- envelope — every rule where it was.
--
-- STABLE, SECURITY INVOKER (the caller is the service role; no privilege is
-- lent), search_path pinned, EXECUTE for service_role only. Deploy order:
-- MIGRATION FIRST (a pure addition; a route ahead of it answers 503
-- `Notifications service updating`, no-store, while it is missing).
-- Reversal: DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.notifications_bell_page(
  p_viewer uuid,
  p_limit int DEFAULT 20,
  p_cursor timestamptz DEFAULT NULL,
  p_unread_only boolean DEFAULT false,
  p_type text DEFAULT NULL
)
RETURNS json
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH page AS (
    SELECT n.*
    FROM public.notifications n
    WHERE n.user_id = p_viewer
      AND (NOT p_unread_only OR n.is_read = false)
      AND (p_type IS NULL OR n.type = p_type)
      AND (p_cursor IS NULL OR n.created_at < p_cursor)
    ORDER BY n.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 20), 0) + 1
  )
  SELECT json_build_object(
    'rows', COALESCE((
      SELECT json_agg(json_build_object(
        'id', n.id, 'type', n.type, 'title', n.title, 'message', n.message, 'action_url', n.action_url,
        'is_read', n.is_read, 'read_at', n.read_at, 'created_at', n.created_at,
        'action_status', n.action_status, 'action_taken_at', n.action_taken_at,
        'grouped_notification_id', n.grouped_notification_id, 'metadata', n.metadata,
        'post_id', n.post_id, 'comment_id', n.comment_id, 'follow_id', n.follow_id,
        -- PostgREST renders an EMBED as jsonb (keys sorted) inside a row whose
        -- own keys keep the select order; built the same way.
        'actor', (SELECT (jsonb_build_object('id', a.id, 'first_name', a.first_name, 'middle_name', a.middle_name,
                                             'last_name', a.last_name, 'full_name', a.full_name, 'avatar_url', a.avatar_url,
                                             'handle', a.handle))::json
                  FROM public.profiles a WHERE a.id = n.actor_id)
      ) ORDER BY n.created_at DESC) FROM page n), '[]'::json),
    'hidden', to_json(public.hidden_authors_for(p_viewer)),
    'unread_count', (SELECT count(*) FROM public.notifications u WHERE u.user_id = p_viewer AND u.is_read = false)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.notifications_bell_page(uuid, int, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notifications_bell_page(uuid, int, timestamptz, boolean, text) TO service_role;
COMMENT ON FUNCTION public.notifications_bell_page(uuid, int, timestamptz, boolean, text) IS
  'The notifications page in one call (284): the route''s page read (limit + 1, newest first, the optional filters and keyset cursor) with the actor embed, the hidden actors (281) and the unread count — raw; GET /api/notifications applies the rules. service_role only.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (284, '284_notifications_bell_page.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 284 APPLIED | 1 | true | 284
SELECT '284 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'notifications_bell_page') AS function_expect_1,
       ((public.notifications_bell_page('00000000-0000-4000-8000-000000000000', 20)::jsonb) = '{"rows": [], "hidden": [], "unread_count": 0}'::jsonb) AS unknown_viewer_is_empty_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_284;
