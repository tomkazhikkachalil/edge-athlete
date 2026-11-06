-- ============================================================================
-- 300: me_pulse counts live BROADCASTS — the header's Live dot lights for a
--      linked YouTube broadcast that is streaming now (Nov 5 2026; the
--      Videos program, Phase 4a; docs/VIDEOS_LIVE.md). Runs on BOTH staging
--      and prod BEFORE the code deploys (the route reads the new key).
-- ============================================================================
-- 292 made the signed-in header's numbers ONE call: me_pulse(viewer) →
-- {live_golf, live_events, unread_messages}. 299 gave a linked broadcast a
-- state; this adds the fourth number, live_broadcasts — the SQL mirror of
-- GET /api/videos/live-now's rule (videos-server.ts listLiveVideos):
--
--   a published `videos` row with live_status = 'live' that the viewer may
--   see under the OWNER's own rule —
--     a profile's: the owner themself, a public present profile, or an
--                  accepted follow (the profile-privacy reads the routes use);
--     an org's:    an org that is not private, or the viewer is its owner or
--                  holds an org-scoped membership row (getOrgAndRole's read).
--
-- The body is 292's with one more key; nothing else changes. The route adds
-- it into liveNow.total; the pulse's parity spec compares the four routes.
-- Reversal: re-run 292's CREATE OR REPLACE (three keys).
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 300) THEN
    RAISE EXCEPTION '300 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 299 THEN RAISE EXCEPTION '300 pre-flight: ledger head is %, expected 299', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = 'me_pulse') THEN
    RAISE EXCEPTION '300 pre-flight: public.me_pulse is missing — 292 has not run here';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'videos' AND column_name = 'live_status') THEN
    RAISE EXCEPTION '300 pre-flight: videos.live_status is missing — 299 has not run here';
  END IF;
END $$;

-- ── 1. The function: 292's body plus live_broadcasts ────────────────────────
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
    'live_broadcasts', (
      SELECT count(*)
      FROM public.videos v
      WHERE v.live_status = 'live'
        AND v.status = 'published'
        AND (
          (v.profile_id IS NOT NULL AND (
            v.profile_id = p_viewer
            OR EXISTS (
              SELECT 1 FROM public.profiles pr
              WHERE pr.id = v.profile_id AND pr.visibility = 'public' AND pr.departed_at IS NULL
            )
            OR EXISTS (
              SELECT 1 FROM public.follows f
              WHERE f.follower_id = p_viewer AND f.following_id = v.profile_id AND f.status = 'accepted'
            )
          ))
          OR (v.org_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.organizations o
            WHERE o.id = v.org_id
              AND (
                o.visibility <> 'private'
                OR o.owner_profile_id = p_viewer
                OR EXISTS (
                  SELECT 1 FROM public.memberships m
                  WHERE m.org_id = o.id AND m.profile_id = p_viewer AND m.scope_type = 'org'
                )
              )
          ))
        )
    ),
    'unread_messages', public.get_unread_message_count(p_viewer)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.me_pulse(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.me_pulse(uuid) TO service_role;

COMMENT ON FUNCTION public.me_pulse(uuid) IS
  'The header''s numbers in one call (292, 300): live golf rounds the viewer may open (round-status.ts rules), live events with a live round the viewer may open (live-now.ts rules), live BROADCASTS the viewer may see (videos-server.ts listLiveVideos: the owner''s own rule), unread messages (get_unread_message_count). GET /api/me/pulse. service_role only.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (300, '300_me_pulse_broadcasts.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 300 APPLIED | 1 | true | 300
SELECT '300 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'me_pulse') AS function_expect_1,
       (public.me_pulse('00000000-0000-4000-8000-000000000000') ?& array['live_golf', 'live_events', 'live_broadcasts', 'unread_messages']) AS unknown_viewer_answers_four_keys_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_300;
