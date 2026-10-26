-- 280 — public_profile_bundle(handle): everything the public profile page's
-- origin reads, in ONE call (trip-count program PR 1, Oct 26 2026 —
-- docs/SCALE_AUDIT.md §7: GET /api/public/profile made 15 database trips;
-- it is the origin behind the CDN-cached /u/[username] page, so every miss
-- paid all fifteen).
--
-- The function returns RAW rows as jsonb; every rule stays in TypeScript
-- exactly as it is today (the statements/media split, tile kinds, proxy URLs,
-- the stranger's org filter, the active-sports union and pin order, the
-- published-only and training exclusions — the predicates here are the
-- route's own, moved verbatim). The route's response does not change
-- (proof: scripts/route-capture.mjs before/after).
--
-- Shape: STABLE, SECURITY INVOKER (the caller is the service role — the admin
-- client the route already uses; no privilege is lent), search_path pinned,
-- EXECUTE for service_role only. A private or unknown handle returns the
-- cheap shape (profile null, or {id, visibility} only) — the route answers
-- 404 / 403 before any heavier read, as it does today.
--
-- Deploy order: MIGRATION FIRST (a pure addition; the route answers 503
-- `Profile service updating`, no-store, while the function is missing).
-- Reversal: DROP FUNCTION; the route's previous reads are in git.

CREATE OR REPLACE FUNCTION public.public_profile_bundle(p_handle text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH prof AS (
  SELECT p.id, p.handle, p.followers_count, p.following_count,
         p.first_name, p.middle_name, p.last_name, p.full_name,
         p.avatar_url, p.cover_url, p.bio, p.sport, p.school, p.location,
         p.city, p.region, p.country, p.country_code,
         p.height_cm, p.weight_kg, p.weight_unit, p.dob, p.class_year,
         p.social_twitter, p.social_instagram, p.social_facebook, p.social_tiktok,
         p.visibility, p.created_at, p.vitals_privacy
  FROM public.profiles p
  WHERE p.handle = lower(p_handle)
  LIMIT 1
),
pub AS (SELECT id FROM prof WHERE visibility = 'public'),
-- the three HEAD counts' predicates, verbatim
counts AS (
  SELECT
    (SELECT count(*) FROM public.posts x, pub WHERE x.profile_id = pub.id AND x.visibility = 'public' AND x.status = 'published') AS posts,
    (SELECT count(*) FROM public.posts x, pub WHERE x.profile_id = pub.id AND x.visibility = 'public' AND x.status = 'published'
        AND NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.post_id = x.id)
        AND x.round_id IS NULL AND x.group_post_id IS NULL
        AND (x.stats_data IS NULL OR x.stats_data = '{}'::jsonb)) AS statements,
    (SELECT count(*) FROM public.posts x, pub WHERE x.profile_id = pub.id AND x.visibility = 'public' AND x.status = 'published'
        AND (x.post_category = 'training' OR x.stats_data->>'type' = 'activity')) AS training
),
recent AS (
  SELECT x.id, x.caption, x.sport_key, x.created_at, x.likes_count, x.comments_count,
         x.stats_data, x.post_category, x.round_id, x.group_post_id, x.shared_post_id,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'media_url', m.media_url, 'media_type', m.media_type) ORDER BY m.display_order, m.id)
                   FROM public.post_media m WHERE m.post_id = x.id), '[]'::jsonb) AS post_media
  FROM public.posts x, pub
  WHERE x.profile_id = pub.id AND x.visibility = 'public' AND x.status = 'published'
  ORDER BY x.created_at DESC
  LIMIT 24
),
originals AS (
  SELECT o.id, o.caption, o.visibility,
         op.full_name AS owner_full_name, op.first_name AS owner_first_name, op.last_name AS owner_last_name, op.visibility AS owner_visibility
  FROM public.posts o
  LEFT JOIN public.profiles op ON op.id = o.profile_id
  WHERE o.id IN (SELECT r.shared_post_id FROM recent r WHERE r.shared_post_id IS NOT NULL)
),
ach AS (
  SELECT a.id, a.title, a.placement, a.achieved_on
  FROM public.athlete_achievements a, pub
  WHERE a.profile_id = pub.id
  ORDER BY a.achieved_on DESC
  LIMIT 12
),
settings AS (
  SELECT s.sport_key, s.settings, s.pinned, s.pin_order
  FROM public.sport_settings s, pub WHERE s.profile_id = pub.id
),
-- the same semantics as get_profile_post_sport_keys: every post's sport_key
sport_keys AS (
  SELECT COALESCE(array_agg(DISTINCT x.sport_key), '{}') AS keys
  FROM public.posts x, pub WHERE x.profile_id = pub.id AND x.sport_key IS NOT NULL
),
golf AS (
  SELECT count(*) AS n FROM public.golf_rounds g, pub WHERE g.profile_id = pub.id
),
-- the stat-line modules' reader (fetchStatLinePosts, the stranger's view):
-- public posts with stats_data, per sport, newest first, at most 200 each
stat_posts AS (
  SELECT COALESCE(jsonb_object_agg(sk, lines), '{}'::jsonb) AS by_sport
  FROM (
    SELECT q.sport_key AS sk, jsonb_agg(q.stats_data ORDER BY q.created_at DESC) AS lines
    FROM (
      SELECT x.sport_key, x.stats_data, x.created_at,
             row_number() OVER (PARTITION BY x.sport_key ORDER BY x.created_at DESC) AS rn
      FROM public.posts x, pub
      WHERE x.profile_id = pub.id AND x.visibility = 'public' AND x.stats_data IS NOT NULL AND x.sport_key IS NOT NULL
    ) q
    WHERE q.rn <= 200
    GROUP BY q.sport_key
  ) g
),
-- the raw membership rows both helpers reduce (profileMembershipRows), and their orgs
mem AS (
  SELECT m.org_id, m.role, m.kind, m.scope_type, m.expires_at, o.kind AS org_kind
  FROM public.memberships m
  JOIN public.organizations o ON o.id = m.org_id, pub
  WHERE m.profile_id = pub.id AND m.kind IN ('follow', 'roster', 'staff')
),
orgs AS (
  SELECT o.id, o.kind, o.name, o.sport_key, o.city, o.region, o.country, o.listing_status, o.approved_at, o.visibility
  FROM public.organizations o
  WHERE o.id IN (SELECT DISTINCT org_id FROM mem)
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM prof) THEN jsonb_build_object('profile', NULL)
  WHEN NOT EXISTS (SELECT 1 FROM pub)  THEN jsonb_build_object('profile', (SELECT jsonb_build_object('id', id, 'visibility', visibility) FROM prof))
  ELSE jsonb_build_object(
    'profile',          (SELECT to_jsonb(prof) FROM prof),
    'counts',           (SELECT to_jsonb(counts) FROM counts),
    'recent_posts',     COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC) FROM recent r), '[]'::jsonb),
    'repost_originals', COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM originals o), '[]'::jsonb),
    'achievements',     COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.achieved_on DESC) FROM ach a), '[]'::jsonb),
    'sport_settings',   COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM settings s), '[]'::jsonb),
    'post_sport_keys',  (SELECT to_jsonb(keys) FROM sport_keys),
    'golf_rounds_count',(SELECT n FROM golf),
    'stat_posts',       (SELECT by_sport FROM stat_posts),
    'memberships',      COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM mem m), '[]'::jsonb),
    'organizations',    COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM orgs o), '[]'::jsonb)
  )
END;
$$;
REVOKE EXECUTE ON FUNCTION public.public_profile_bundle(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_profile_bundle(text) TO service_role;
COMMENT ON FUNCTION public.public_profile_bundle(text) IS
  'Everything GET /api/public/profile reads, as one jsonb of raw rows (280): the profile, the three counts, 24 recent public posts with media, repost originals, achievements, sport settings, posted sport keys, the golf round count, public stat-line posts per sport, raw membership rows and their orgs. Rules stay in TypeScript (src/app/api/public/profile/route.ts). service_role only.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (280, '280_public_profile_bundle.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 280 APPLIED | 1 | true | 280
SELECT '280 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'public_profile_bundle') AS function_expect_1,
       (public.public_profile_bundle('no-such-handle-280') = '{"profile": null}'::jsonb) AS unknown_handle_is_null_profile_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_280;
