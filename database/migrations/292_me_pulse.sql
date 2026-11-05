-- 292 — me_pulse: the signed-in header's two numbers in ONE call (the cost
-- program PR B, Oct 29 2026 — docs/COST.md, docs/specs/pulse.md). Every
-- signed-in visible tab used to make three function calls a minute on every
-- page for them: /api/golf/live-now/count + /api/sport-events/live-now?count=1
-- once a minute (the header's Live dot) and /api/messages/unread-count every
-- two minutes (the bell) — each its own Vercel invocation and its own two to
-- four Supabase trips. me_pulse answers the three in one SQL function:
--
--   me_pulse(viewer) → {"live_golf": n, "live_events": n, "unread_messages": n}
--
-- The predicates are the SQL mirror of the pure rules the routes apply
-- (pinned by src/lib/__tests__/me-pulse.test.ts):
--   live_golf      countLiveVisibleRounds / isRoundLive (src/lib/golf/round-status.ts):
--                  type golf_round, status pending | active, the round's DATE
--                  within ±48 h of now (group_posts.date is date-only, read
--                  as UTC midnight like Date.parse), and public OR the viewer
--                  on the roster with any status but 'declined'
--                  (isActiveParticipant: only an explicit decline excludes).
--   live_events    readLiveEvents / liveEventCards (src/lib/sport-events/live-now*.ts):
--                  sport_events.status = 'live', public OR the viewer's own
--                  ACCEPTED row, AND a round with status 'live' (an event
--                  with no live round shows no card).
--   unread_messages get_unread_message_count (026 / 131) as it is.
--
-- STABLE sql, SECURITY INVOKER (the service-role caller; no privilege lent —
-- 288's style), search_path pinned, EXECUTE for service_role only. Deploy
-- order: MIGRATION FIRST (a pure addition; a route ahead of it answers 503
-- `Pulse updating`, no-store). Reversal: DROP FUNCTION public.me_pulse(uuid).

CREATE OR REPLACE FUNCTION public.me_pulse(p_viewer uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'live_golf', (
      SELECT count(*)
      FROM public.group_posts gp
      WHERE gp.type = 'golf_round'
        AND gp.status IN ('pending', 'active')
        AND (gp.date::timestamp AT TIME ZONE 'UTC')
              BETWEEN now() - interval '48 hours' AND now() + interval '48 hours'
        AND (
          gp.visibility = 'public'
          OR EXISTS (
            SELECT 1 FROM public.group_post_participants gpp
            WHERE gpp.group_post_id = gp.id
              AND gpp.profile_id = p_viewer
              AND gpp.status IS DISTINCT FROM 'declined'
          )
        )
    ),
    'live_events', (
      SELECT count(*)
      FROM public.sport_events e
      WHERE e.status = 'live'
        AND (
          e.visibility = 'public'
          OR EXISTS (
            SELECT 1 FROM public.sport_event_participants sp
            WHERE sp.sport_event_id = e.id
              AND sp.profile_id = p_viewer
              AND sp.status = 'accepted'
          )
        )
        AND EXISTS (
          SELECT 1 FROM public.sport_event_rounds r
          WHERE r.sport_event_id = e.id AND r.status = 'live'
        )
    ),
    'unread_messages', public.get_unread_message_count(p_viewer)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.me_pulse(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.me_pulse(uuid) TO service_role;
COMMENT ON FUNCTION public.me_pulse(uuid) IS
  'The header''s numbers in one call (292): live golf rounds the viewer may open (round-status.ts rules), live events with a live round the viewer may open (live-now.ts rules), unread messages (get_unread_message_count). GET /api/me/pulse. service_role only.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (292, '292_me_pulse.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 292 APPLIED | 1 | true | 292
SELECT '292 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'me_pulse') AS function_expect_1,
       (public.me_pulse('00000000-0000-4000-8000-000000000000') ?& array['live_golf', 'live_events', 'unread_messages']) AS unknown_viewer_answers_three_keys_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_292;
