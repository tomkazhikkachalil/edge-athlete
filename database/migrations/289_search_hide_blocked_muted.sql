-- 289 — search hides blocked people and muted authors' posts (the leftovers
-- program PR 4, Oct 28 2026 — Tom's decision: "blocks both ways + muted
-- authors' posts"). Search applied no block or mute filter: a person who
-- blocked the viewer (or whom the viewer blocked) still came back as an
-- athlete and as a post author, and a muted person's posts — gone from the
-- feed since Spec 2 (223) — still came back as search results.
--
-- 283's search_all_decorated is re-declared with the SAME body plus two keys:
--   blocked = the two user_blocks arms for the viewer (ids)
--   hidden  = hidden_authors_for(viewer) (281: muted ∪ blocked ∪ blockers)
-- The route applies them: an athlete in `blocked` leaves the list BEFORE the
-- quota slice (a blocked person never consumes a slot); a post whose author
-- is in `hidden` leaves the posts (the feed's rule). Clubs, leagues and
-- courses are untouched; a muted person is still found as a person. The
-- anonymous viewer has no viewer — both sets are empty and nothing changes.
--
-- Same shape as 283 otherwise (json, key order kept; STABLE SECURITY INVOKER;
-- service_role only). Deploy order: MIGRATION FIRST (the route reads the new
-- keys with `?? []`, so either order is safe; first keeps the rule exact from
-- the first request). Reversal: re-run 283.

CREATE OR REPLACE FUNCTION public.search_all_decorated(
  q text,
  p_types text[] DEFAULT NULL,
  max_per_type int DEFAULT 20,
  visible_ids uuid[] DEFAULT '{}',
  include_public boolean DEFAULT TRUE,
  p_country_code text DEFAULT NULL,
  p_region_code text DEFAULT NULL,
  p_near_lat float8 DEFAULT NULL,
  p_near_lng float8 DEFAULT NULL,
  p_radius_km float8 DEFAULT NULL,
  p_viewer uuid DEFAULT NULL,
  p_post_sport text DEFAULT NULL,
  p_post_from timestamptz DEFAULT NULL,
  p_post_to timestamptz DEFAULT NULL,
  p_post_limit int DEFAULT 15
)
RETURNS json
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH r AS (
    SELECT t.*
    FROM public.search_all(q, p_types, max_per_type, visible_ids, include_public,
                           p_country_code, p_region_code, p_near_lat, p_near_lng, p_radius_km)
         WITH ORDINALITY AS t(entity_type, entity_id, title, subtitle, sport_key, city, region, region_code,
                              country, country_code, place_id, lat, lng, distance_km, match_rank, ord)
  ),
  -- The route's posts read, verbatim: the ranked ids, published, on the feed,
  -- the optional filters, newest first, the quota.
  ps AS (
    SELECT p.*
    FROM public.posts p
    WHERE p.id IN (SELECT entity_id FROM r WHERE entity_type = 'post')
      AND p.status = 'published'
      AND p.on_feed = true
      AND (p_post_sport IS NULL OR p.sport_key = p_post_sport)
      AND (p_post_from IS NULL OR p.created_at >= p_post_from)
      AND (p_post_to IS NULL OR p.created_at <= p_post_to)
    ORDER BY p.created_at DESC
    LIMIT GREATEST(COALESCE(p_post_limit, 15), 0)
  ),
  authors AS (SELECT DISTINCT profile_id AS id FROM ps WHERE profile_id IS NOT NULL)
  SELECT json_build_object(
    'rows', COALESCE((
      SELECT json_agg(json_build_object(
        'entity_type', entity_type, 'entity_id', entity_id, 'title', title, 'subtitle', subtitle, 'sport_key', sport_key,
        'city', city, 'region', region, 'region_code', region_code, 'country', country, 'country_code', country_code,
        'place_id', place_id, 'lat', lat, 'lng', lng, 'distance_km', distance_km, 'match_rank', match_rank
      ) ORDER BY ord) FROM r), '[]'::json),
    'athletes', COALESCE((
      SELECT json_agg(json_build_object(
        'id', a.id, 'handle', a.handle, 'first_name', a.first_name, 'middle_name', a.middle_name, 'last_name', a.last_name,
        'full_name', a.full_name, 'avatar_url', a.avatar_url, 'location', a.location, 'sport', a.sport, 'school', a.school,
        'visibility', a.visibility, 'city', a.city, 'region', a.region, 'region_code', a.region_code,
        'country', a.country, 'country_code', a.country_code
      )) FROM public.profiles a WHERE a.id IN (SELECT entity_id FROM r WHERE entity_type = 'athlete')), '[]'::json),
    'courses', COALESCE((
      SELECT json_agg(json_build_object(
          'id', g.id,
          'external_source', g.external_source,
          'external_id', g.external_id,
          'name', g.name,
          'club_name', g.club_name,
          'city', g.city,
          'region', g.region,
          'country', g.country,
          'total_par', g.total_par,
          'holes_count', g.holes_count,
          'hole_data', g.hole_data,
          'course_rating', g.course_rating,
          'slope_rating', g.slope_rating,
          'lat', g.lat,
          'lng', g.lng,
          'description', g.description,
          'description_attribution', g.description_attribution,
          'architect', g.architect,
          'year_built', g.year_built,
          'course_type', g.course_type,
          'website', g.website,
          'phone', g.phone,
          'hydrated_at', g.hydrated_at,
          'place_id', g.place_id,
          'country_code', g.country_code,
          'region_code', g.region_code,
          'location_source', g.location_source,
          'club_id', g.club_id,
          'section_name', g.section_name,
          'section_kind', g.section_kind
      )) FROM public.golf_courses g WHERE g.id IN (SELECT entity_id FROM r WHERE entity_type = 'course')), '[]'::json),
    'posts', COALESCE((
      SELECT json_agg(json_build_object(
        'id', p.id, 'caption', p.caption, 'sport_key', p.sport_key, 'hashtags', p.hashtags, 'tags', p.tags, 'created_at', p.created_at,
        -- PostgREST renders an EMBED as jsonb (keys sorted by length, then
        -- bytewise) inside a row whose own keys keep the select order; the
        -- embeds are built the same way so the bytes match.
        'profile', (SELECT (jsonb_build_object('id', pr.id, 'full_name', pr.full_name, 'first_name', pr.first_name,
                                               'middle_name', pr.middle_name, 'last_name', pr.last_name, 'avatar_url', pr.avatar_url))::json
                    FROM public.profiles pr WHERE pr.id = p.profile_id),
        'post_media', COALESCE((SELECT json_agg((jsonb_build_object('media_url', m.media_url, 'media_type', m.media_type))::json
                                                ORDER BY m.display_order, m.id)
                                FROM public.post_media m WHERE m.post_id = p.id), '[]'::json)
      ) ORDER BY p.created_at DESC) FROM ps p), '[]'::json),
    'clubs', COALESCE((
      SELECT json_agg(json_build_object(
        'id', o.id, 'name', o.name, 'description', o.description, 'location', o.location, 'city', o.city, 'region', o.region,
        'region_code', o.region_code, 'country', o.country, 'country_code', o.country_code, 'lat', o.lat, 'lng', o.lng,
        'visibility', o.visibility, 'listing_status', o.listing_status, 'approved_at', o.approved_at
      )) FROM public.organizations o WHERE o.kind = 'club' AND o.id IN (SELECT entity_id FROM r WHERE entity_type = 'club')), '[]'::json),
    'leagues', COALESCE((
      SELECT json_agg(json_build_object(
        'id', o.id, 'name', o.name, 'description', o.description, 'sport_key', o.sport_key, 'city', o.city, 'region', o.region,
        'region_code', o.region_code, 'country', o.country, 'country_code', o.country_code, 'lat', o.lat, 'lng', o.lng,
        'visibility', o.visibility, 'listing_status', o.listing_status, 'approved_at', o.approved_at
      )) FROM public.organizations o WHERE o.kind = 'league' AND o.id IN (SELECT entity_id FROM r WHERE entity_type = 'league')), '[]'::json),
    -- 289 (the leftovers program PR 4 — Tom: blocks both ways hide the person
    -- and their posts; a mute hides only the posts): the viewer's hidden set
    -- (281's hidden_authors_for = muted ∪ blocked ∪ blockers) and its block-only
    -- subset, as ids; the route applies them — athletes by `blocked` before the
    -- quota slice, posts by `hidden`. Anonymous: both empty.
    'blocked', COALESCE((
      SELECT json_agg(DISTINCT x.id) FROM (
        SELECT b.blocked_id AS id FROM public.user_blocks b WHERE p_viewer IS NOT NULL AND b.blocker_id = p_viewer
        UNION ALL
        SELECT c.blocker_id FROM public.user_blocks c WHERE p_viewer IS NOT NULL AND c.blocked_id = p_viewer
      ) x), '[]'::json),
    'hidden', CASE WHEN p_viewer IS NULL THEN '[]'::json ELSE to_json(public.hidden_authors_for(p_viewer)) END,
    'author_visibility', COALESCE((
      SELECT json_agg(json_build_object('id', pr.id, 'visibility', pr.visibility))
      FROM public.profiles pr WHERE pr.id IN (SELECT id FROM authors)), '[]'::json),
    'followed_private', COALESCE((
      SELECT json_agg(f.following_id)
      FROM public.follows f
      WHERE p_viewer IS NOT NULL AND f.follower_id = p_viewer AND f.status = 'accepted'
        AND f.following_id IN (SELECT pr.id FROM public.profiles pr
                               WHERE pr.id IN (SELECT id FROM authors) AND pr.visibility IS DISTINCT FROM 'public')), '[]'::json)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.search_all_decorated(text, text[], int, uuid[], boolean, text, text, float8, float8, float8, uuid, text, timestamptz, timestamptz, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_all_decorated(text, text[], int, uuid[], boolean, text, text, float8, float8, float8, uuid, text, timestamptz, timestamptz, int)
  TO service_role;
COMMENT ON FUNCTION public.search_all_decorated(text, text[], int, uuid[], boolean, text, text, float8, float8, float8, uuid, text, timestamptz, timestamptz, int) IS
  'search_all plus its decoration in one call (283; 289 adds blocked + hidden): the ranked rows, the raw display rows per entity type in the route''s column order, the post authors'' visibility and the viewer''s accepted follows among the private ones — raw; GET /api/search applies every rule. json (key order kept). service_role only.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (289, '289_search_hide_blocked_muted.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 289 APPLIED | 1 | true | 289
SELECT '289 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'search_all_decorated') AS function_expect_1,
       ((public.search_all_decorated('', ARRAY['athlete'], 20, '{}', true)::jsonb) ? 'blocked'
        AND (public.search_all_decorated('', ARRAY['athlete'], 20, '{}', true)::jsonb) ? 'hidden') AS new_keys_present_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_289;
