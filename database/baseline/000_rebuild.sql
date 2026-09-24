-- ============================================================================
-- 000_rebuild — a blank Supabase project → this schema (GENERATED, do not edit)
-- ============================================================================
-- Generated 2026-09-24T03:39:29.646241+00:00 from server 17.4 by
-- `npm run build:baseline` (scripts/build-rebuild-baseline.mjs) over
-- public.schema_dump() (migration 227). Ledger head at generation: 237.
--
-- WHY THIS FILE: the numbered chain does not replay on a blank database
-- (database/MIGRATIONS.md, "To build an environment"). This is the live
-- schema as DDL, in dependency order, every statement guarded so it is
-- re-runnable. Run it WHOLE in the new project's SQL editor; then point
-- .env.local at the project and `npm run check:schema` must report 0
-- drift and `Ledger OK` — that is the only proof the environment is built.
--
-- NOT in this file, by design: user data; the golf catalog (28k courses —
-- data, copied separately); storage OBJECTS; auth users; secrets. The
-- pg_cron jobs are at the end, commented, for review.
-- ============================================================================

SET check_function_bodies = off;


-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ── Enum types ────────────────────────────────────────────────────────────────


-- ── Sequences ─────────────────────────────────────────────────────────────────


-- ── Functions, pass 1 (109; failures silenced, pass 2 is authoritative) ───────
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.auto_update_display_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Auto-generate display name from first/last name if empty
  IF NEW.first_name IS NOT NULL AND NEW.last_name IS NOT NULL THEN
    IF NEW.full_name IS NULL OR NEW.full_name = '' THEN
      NEW.full_name := NEW.first_name || ' ' || NEW.last_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.backfill_places_from_text(p_table regclass)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE n int;
BEGIN
  EXECUTE format($f$
    WITH parsed AS (
      SELECT t.id,
             public.search_normalize(btrim(split_part(t.location, ',', 1))) AS p1,
             public.search_normalize(btrim(split_part(t.location, ',', 2))) AS p2
      FROM %1$s t
      WHERE t.location IS NOT NULL AND btrim(t.location) <> ''
        AND (t.location_source IS NULL OR t.location_source <> 'user')
    ),
    cand AS (
      SELECT pr.id AS entity_id, pl.id AS place_id, pr.p2,
             (pr.p2 <> '' AND (
                public.search_normalize(pl.region) = pr.p2 OR public.search_normalize(pl.region_code) = pr.p2 OR
                public.search_normalize(pl.country) = pr.p2 OR public.search_normalize(pl.country_code) = pr.p2)) AS p2_match,
             count(*) OVER (PARTITION BY pr.id) AS n_cand,
             row_number() OVER (PARTITION BY pr.id ORDER BY
               (pr.p2 <> '' AND (
                public.search_normalize(pl.region) = pr.p2 OR public.search_normalize(pl.region_code) = pr.p2 OR
                public.search_normalize(pl.country) = pr.p2 OR public.search_normalize(pl.country_code) = pr.p2)) DESC,
               pl.population DESC NULLS LAST) AS rn
      FROM parsed pr
      JOIN LATERAL (
        SELECT pl.* FROM places pl
        WHERE public.search_normalize(pl.name) = pr.p1 OR public.search_normalize(pl.ascii_name) = pr.p1
        UNION
        SELECT pl.* FROM places pl
        JOIN place_aliases a ON a.geonames_id = pl.geonames_id
        WHERE a.alias_norm = pr.p1
      ) pl ON pr.p1 <> ''
    ),
    chosen AS (
      SELECT c.entity_id, c.place_id FROM cand c
      WHERE c.rn = 1 AND ((c.p2 <> '' AND c.p2_match) OR (c.p2 = '' AND c.n_cand = 1))
    )
    UPDATE %1$s t SET
      place_id = ch.place_id,
      city = f.city, region = f.region, region_code = f.region_code,
      country = f.country, country_code = f.country_code, lat = f.lat, lng = f.lng,
      location_source = 'backfill'
    FROM chosen ch, LATERAL public.place_fields(ch.place_id) f
    WHERE t.id = ch.entity_id AND t.place_id IS DISTINCT FROM ch.place_id
  $f$, p_table);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.bump_hole_score_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.strokes, NEW.putts, NEW.fairway_hit, NEW.green_in_regulation, NEW.penalties)
     IS DISTINCT FROM
     (OLD.strokes, OLD.putts, OLD.fairway_hit, OLD.green_in_regulation, OLD.penalties) THEN
    NEW.version = OLD.version + 1;
  ELSE
    NEW.version = OLD.version;
  END IF;
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.bump_site_hit(p_site uuid, p_day date, p_path text, p_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new integer := 0;
BEGIN
  IF p_hash IS NOT NULL AND p_hash <> '' THEN
    INSERT INTO org_site_hit_marks (site_id, day, visitor_hash)
    VALUES (p_site, p_day, p_hash)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_new := 1; END IF;
  END IF;
  INSERT INTO org_site_stats_daily (site_id, day, path, views, visitors)
  VALUES (p_site, p_day, p_path, 1, v_new)
  ON CONFLICT (site_id, day, path) DO UPDATE
    SET views = org_site_stats_daily.views + 1,
        visitors = org_site_stats_daily.visitors + EXCLUDED.visitors;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.calculate_golf_participant_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_golf_participant_id UUID;
  v_total_score INTEGER;
  v_holes_completed INTEGER;
  v_played_par INTEGER;
  v_to_par INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_golf_participant_id := OLD.golf_participant_id;
  ELSE
    v_golf_participant_id := NEW.golf_participant_id;
  END IF;

  SELECT
    COALESCE(SUM(strokes), 0),
    COUNT(*)
  INTO v_total_score, v_holes_completed
  FROM public.golf_hole_scores
  WHERE golf_participant_id = v_golf_participant_id;

  -- Real par for the PLAYED holes, from the round's hole_data; NULL when the
  -- round has no hole_data (legacy) → fall back to the old holes*4 estimate.
  SELECT SUM((elem->>'par')::int)
  INTO v_played_par
  FROM public.golf_participant_scores gps
  JOIN public.group_post_participants gpp ON gpp.id = gps.participant_id
  JOIN public.golf_scorecard_data gsd ON gsd.group_post_id = gpp.group_post_id
  CROSS JOIN LATERAL jsonb_array_elements(gsd.hole_data) elem
  WHERE gps.id = v_golf_participant_id
    AND gsd.hole_data IS NOT NULL
    AND (elem->>'hole')::int IN (
      SELECT hole_number FROM public.golf_hole_scores
      WHERE golf_participant_id = v_golf_participant_id
    );

  IF v_holes_completed > 0 THEN
    v_to_par := v_total_score - COALESCE(v_played_par, v_holes_completed * 4);
  ELSE
    v_to_par := NULL;
  END IF;

  UPDATE public.golf_participant_scores
  SET
    total_score = v_total_score,
    to_par = v_to_par,
    holes_completed = v_holes_completed,
    updated_at = NOW()
  WHERE id = v_golf_participant_id;

  UPDATE public.group_post_participants
  SET
    data_contributed = (v_holes_completed > 0),
    last_contribution = CASE WHEN v_holes_completed > 0 THEN NOW() ELSE last_contribution END,
    updated_at = NOW()
  WHERE id = (
    SELECT participant_id FROM public.golf_participant_scores WHERE id = v_golf_participant_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.calculate_round_stats(round_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    total_strokes INTEGER;
    total_putts_calc INTEGER;
    total_par INTEGER;
    fir_count INTEGER;
    fir_eligible INTEGER;
    gir_count INTEGER;
    total_holes INTEGER;
BEGIN
    -- Get basic stats from holes
    SELECT
        COALESCE(SUM(strokes), 0),
        COALESCE(SUM(putts), 0),
        COALESCE(SUM(par), 0),
        COUNT(*) FILTER (WHERE fairway_hit = true),
        COUNT(*) FILTER (WHERE par > 3),
        COUNT(*) FILTER (WHERE green_in_regulation = true),
        COUNT(*)
    INTO total_strokes, total_putts_calc, total_par, fir_count, fir_eligible, gir_count, total_holes
    FROM public.golf_holes
    WHERE round_id = round_uuid;

    -- Update round with calculated stats
    UPDATE public.golf_rounds
    SET
        gross_score = CASE WHEN total_strokes > 0 THEN total_strokes ELSE gross_score END,
        par = CASE WHEN total_par > 0 THEN total_par ELSE par END,
        total_putts = CASE WHEN total_putts_calc > 0 THEN total_putts_calc ELSE total_putts END,
        fir_percentage = CASE WHEN fir_eligible > 0 THEN ROUND((fir_count::decimal / fir_eligible) * 100, 1) ELSE fir_percentage END,
        gir_percentage = CASE WHEN total_holes > 0 THEN ROUND((gir_count::decimal / total_holes) * 100, 1) ELSE gir_percentage END,
        is_complete = (total_holes >= holes),
        updated_at = now()
    WHERE id = round_uuid;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.can_view_group_post(gp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.group_posts
    WHERE id = gp_id AND (visibility = 'public' OR creator_id = auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.group_post_participants
    WHERE group_post_id = gp_id AND profile_id = auth.uid()
  );
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.can_view_profile(target_profile_id uuid, viewer_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  profile_vis TEXT;
  is_following BOOLEAN;
BEGIN
  SELECT visibility INTO profile_vis
  FROM public.profiles
  WHERE id = target_profile_id;

  -- Own profile
  IF target_profile_id = viewer_id THEN
    RETURN TRUE;
  END IF;

  -- Guardian / supervised / viewer access rows (guardian-profiles feature)
  IF viewer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profile_access
    WHERE profile_id = target_profile_id AND user_id = viewer_id
  ) THEN
    RETURN TRUE;
  END IF;

  -- Public profile
  IF profile_vis = 'public' THEN
    RETURN TRUE;
  END IF;

  -- Private profile - check if following
  SELECT EXISTS (
    SELECT 1 FROM public.follows
    WHERE follower_id = viewer_id
      AND following_id = target_profile_id
      AND status = 'accepted'
  ) INTO is_following;

  RETURN is_following;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.check_handle_availability(input_handle text, current_profile_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(available boolean, reason text, suggestions text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  clean_handle TEXT;
  is_valid BOOLEAN;
  existing_profile UUID;
  is_reserved BOOLEAN;
BEGIN
  -- Clean the handle
  clean_handle := LOWER(TRIM(input_handle));

  -- Check if valid format (inline validation)
  is_valid := (
    LENGTH(clean_handle) >= 3 AND
    LENGTH(clean_handle) <= 20 AND
    clean_handle ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$' AND
    NOT clean_handle ~ '[._]{2,}'
  );

  IF NOT is_valid THEN
    RETURN QUERY SELECT
      FALSE,
      'Invalid format. Use 3-20 characters: letters, numbers, dots, underscores.',
      ARRAY[]::TEXT[];
    RETURN;
  END IF;

  -- Check if reserved
  SELECT EXISTS (
    SELECT 1 FROM public.reserved_handles
    WHERE LOWER(handle) = clean_handle
  ) INTO is_reserved;

  IF is_reserved THEN
    RETURN QUERY SELECT
      FALSE,
      'This handle is reserved.',
      ARRAY[clean_handle || '1', clean_handle || '_', clean_handle || '2']::TEXT[];
    RETURN;
  END IF;

  -- Check if already taken
  SELECT id INTO existing_profile
  FROM public.profiles
  WHERE LOWER(handle) = clean_handle
    AND (current_profile_id IS NULL OR id != current_profile_id)
  LIMIT 1;

  IF existing_profile IS NOT NULL THEN
    -- Generate suggestions
    RETURN QUERY SELECT
      FALSE,
      'This handle is already taken.',
      ARRAY[
        clean_handle || '1',
        clean_handle || '_',
        clean_handle || '2',
        clean_handle || '.' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 3)
      ]::TEXT[];
    RETURN;
  END IF;

  -- Available!
  RETURN QUERY SELECT
    TRUE,
    'Handle is available!',
    ARRAY[]::TEXT[];
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- SCHEMA-QUALIFIED notifications table
  DELETE FROM public.notifications
  WHERE is_read = true AND read_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.consent_records_forbid_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     -- each FK: unchanged, or transitioning to NULL
     AND (NEW.profile_id IS NOT DISTINCT FROM OLD.profile_id
          OR (NEW.profile_id IS NULL AND OLD.profile_id IS NOT NULL))
     AND (NEW.guardian_user_id IS NOT DISTINCT FROM OLD.guardian_user_id
          OR (NEW.guardian_user_id IS NULL AND OLD.guardian_user_id IS NOT NULL))
     -- at least one FK actually changing (no-op updates stay forbidden)
     AND (NEW.profile_id IS DISTINCT FROM OLD.profile_id
          OR NEW.guardian_user_id IS DISTINCT FROM OLD.guardian_user_id)
     -- everything else identical
     AND (to_jsonb(NEW) - 'profile_id' - 'guardian_user_id')
         = (to_jsonb(OLD) - 'profile_id' - 'guardian_user_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rows in consent_records are append-only';
END; $function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.create_managed_profile(p_profile jsonb, p_guardian uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  new_id uuid;
BEGIN
  IF (
    SELECT count(*) FROM public.profile_access
    WHERE user_id = p_guardian AND role = 'guardian'
  ) >= 10 THEN
    RAISE EXCEPTION 'guardian % manages too many profiles', p_guardian;
  END IF;

  INSERT INTO public.profiles
  SELECT * FROM jsonb_populate_record(NULL::public.profiles, p_profile)
  RETURNING id INTO new_id;

  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (p_guardian, new_id, 'guardian', p_guardian);

  INSERT INTO public.profile_access_audit (profile_id, user_id, action, new_role, actor_id)
  VALUES (new_id, p_guardian, 'granted', 'guardian', p_guardian);

  RETURN new_id;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_type text, p_actor_id uuid, p_title text, p_message text DEFAULT NULL::text, p_action_url text DEFAULT NULL::text, p_post_id uuid DEFAULT NULL::uuid, p_comment_id uuid DEFAULT NULL::uuid, p_follow_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_notification_id UUID;
  v_preferences RECORD;
BEGIN
  -- Don't notify self
  IF p_actor_id = p_user_id THEN RETURN NULL; END IF;

  -- Get or create preferences (SCHEMA-QUALIFIED)
  SELECT * INTO v_preferences
  FROM public.notification_preferences
  WHERE user_id = p_user_id;

  IF v_preferences IS NULL THEN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_preferences;
  END IF;

  -- Check if notification type is enabled
  IF (
    (p_type = 'follow_request' AND v_preferences.follow_requests_enabled) OR
    (p_type = 'follow_accepted' AND v_preferences.follow_accepted_enabled) OR
    (p_type = 'new_follower' AND v_preferences.new_followers_enabled) OR
    (p_type = 'like' AND v_preferences.likes_enabled) OR
    (p_type = 'comment' AND v_preferences.comments_enabled) OR
    (p_type = 'mention' AND v_preferences.mentions_enabled) OR
    (p_type = 'tag' AND v_preferences.tags_enabled) OR
    (p_type = 'achievement' AND v_preferences.achievements_enabled) OR
    (p_type = 'system_announcement' AND v_preferences.system_announcements_enabled) OR
    (p_type = 'club_update' AND v_preferences.club_updates_enabled)
  ) THEN
    INSERT INTO public.notifications (
      user_id, type, actor_id, title, message, action_url,
      post_id, comment_id, follow_id, metadata
    ) VALUES (
      p_user_id, p_type, p_actor_id, p_title, p_message, p_action_url,
      p_post_id, p_comment_id, p_follow_id, p_metadata
    )
    RETURNING id INTO v_notification_id;
    RETURN v_notification_id;
  END IF;

  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.create_profile_with_owner(p_profile jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.profiles
  SELECT * FROM jsonb_populate_record(NULL::public.profiles, p_profile)
  RETURNING id INTO new_id;

  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (new_id, new_id, 'owner', new_id);

  RETURN new_id;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.create_stub_profile(p_id uuid, p_email text, p_first_name text, p_last_name text, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_full text := trim(p_first_name || ' ' || coalesce(p_last_name, ''));
BEGIN
  INSERT INTO public.profiles
    (id, email, first_name, last_name, full_name, display_name,
     user_type, visibility, supervision_state)
  VALUES
    (p_id, p_email, p_first_name, NULLIF(p_last_name, ''), v_full, v_full,
     'athlete', 'private', 'supervised');

  -- 048: a supervised SELF row is legal (user_id = profile_id) and takes
  -- the one-self-role slot. The adult claim FLIPS it to owner; the
  -- guardian claim DELETES it (after the guardian row exists) so the
  -- credentials_gap queue item surfaces.
  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (p_id, p_id, 'supervised', p_created_by);

  INSERT INTO public.profile_access_audit (profile_id, user_id, action, new_role, actor_id)
  VALUES (p_id, p_id, 'granted', 'supervised', p_created_by);

  RETURN p_id;
END; $function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.decrement_comment_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.post_comments
  SET likes_count = GREATEST(0, likes_count - 1)
  WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.decrement_post_save_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.posts
  SET saves_count = GREATEST(0, saves_count - 1)
  WHERE id = OLD.post_id;
  RETURN OLD;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.enforce_guardian_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.role = 'guardian' AND (
    SELECT count(*) FROM public.profile_access
    WHERE profile_id = NEW.profile_id AND role = 'guardian'
  ) > 2 THEN
    RAISE EXCEPTION 'profile % already has the maximum of 2 guardians', NEW.profile_id;
  END IF;
  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.enforce_last_guardian()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Only departures from the guardian role matter.
  IF OLD.role <> 'guardian' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'guardian' THEN
    RETURN NULL;
  END IF;

  -- Cascade tolerance: either side's profiles row already gone = a cascade
  -- in flight; the app layer owns those flows.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.profile_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
    RETURN NULL;
  END IF;

  -- Only supervised, un-parked children are protected.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = OLD.profile_id
      AND supervision_state = 'supervised'
      AND deletion_requested_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- The transfer executor's flip_access→finalize window.
  IF EXISTS (
    SELECT 1 FROM public.profile_transfers
    WHERE profile_id = OLD.profile_id AND state = 'executing'
  ) THEN
    RETURN NULL;
  END IF;

  -- Deferred AFTER trigger: the count reflects the transaction's final state.
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_access
    WHERE profile_id = OLD.profile_id AND role = 'guardian'
  ) THEN
    RAISE EXCEPTION
      'profile % must keep at least one guardian while supervised (last-guardian backstop, migration 136)',
      OLD.profile_id;
  END IF;

  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.enforce_profile_has_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  affected UUID;
BEGIN
  affected := COALESCE(OLD.profile_id, NEW.profile_id);
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = affected)
     AND NOT EXISTS (SELECT 1 FROM public.profile_access WHERE profile_id = affected) THEN
    RAISE EXCEPTION 'profile % cannot be left with zero access rows', affected;
  END IF;
  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.feed_following(p_viewer uuid, p_limit integer, p_cursor_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_offset integer DEFAULT 0)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.follows_counts_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  old_live boolean := (TG_OP <> 'INSERT') AND (OLD.status = 'accepted');
  new_live boolean := (TG_OP <> 'DELETE') AND (NEW.status = 'accepted');
BEGIN
  -- Only an accepted edge counts. A row that stays accepted but changes
  -- another column is a no-op; a row that changes its endpoints (never
  -- done by the app) is handled as remove-then-add.
  IF old_live AND new_live AND OLD.follower_id = NEW.follower_id AND OLD.following_id = NEW.following_id THEN
    RETURN NULL;
  END IF;
  IF old_live THEN
    UPDATE public.profiles SET followers_count = GREATEST(0, COALESCE(followers_count, 0) - 1) WHERE id = OLD.following_id;
    UPDATE public.profiles SET following_count = GREATEST(0, COALESCE(following_count, 0) - 1) WHERE id = OLD.follower_id;
  END IF;
  IF new_live THEN
    UPDATE public.profiles SET followers_count = COALESCE(followers_count, 0) + 1 WHERE id = NEW.following_id;
    UPDATE public.profiles SET following_count = COALESCE(following_count, 0) + 1 WHERE id = NEW.follower_id;
  END IF;
  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.forbid_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'rows in % are append-only', TG_TABLE_NAME;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.generate_connection_suggestions(p_user_profile_id uuid, p_suggestion_limit integer DEFAULT 10)
 RETURNS TABLE(suggested_id uuid, suggested_name text, suggested_avatar text, suggested_sport text, suggested_school text, suggested_location text, similarity_score integer, reason text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_sport TEXT;
  v_user_school TEXT;
  v_user_location TEXT;
BEGIN
  -- First, get the requesting user's profile data
  SELECT
    sport,
    school,
    location
  INTO
    v_user_sport,
    v_user_school,
    v_user_location
  FROM public.profiles
  WHERE id = p_user_profile_id;

  -- Return suggested profiles
  RETURN QUERY
  SELECT
    p.id AS suggested_id,
    COALESCE(
      p.full_name,
      NULLIF(TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))), '')
    ) AS suggested_name,
    p.avatar_url AS suggested_avatar,
    p.sport AS suggested_sport,
    p.school AS suggested_school,
    p.location AS suggested_location,
    -- Calculate similarity score
    (
      CASE WHEN p.sport IS NOT NULL AND p.sport = v_user_sport THEN 30 ELSE 0 END +
      CASE WHEN p.school IS NOT NULL AND p.school = v_user_school THEN 20 ELSE 0 END +
      CASE WHEN p.location IS NOT NULL AND p.location = v_user_location THEN 10 ELSE 0 END +
      -- Bonus points for common connections (capped at 25 points)
      LEAST(
        COALESCE((
          SELECT COUNT(*)::INTEGER * 5
          FROM public.follows f1
          INNER JOIN public.follows f2 ON f1.following_id = f2.following_id
          WHERE f1.follower_id = p_user_profile_id
            AND f2.follower_id = p.id
            AND f1.status = 'accepted'
            AND f2.status = 'accepted'
        ), 0),
        25
      )
    )::INTEGER AS similarity_score,
    -- Generate human-readable reason
    CASE
      WHEN p.sport IS NOT NULL AND p.sport = v_user_sport THEN
        CONCAT('Also plays ', p.sport)
      WHEN p.school IS NOT NULL AND p.school = v_user_school THEN
        CONCAT('Also attends ', p.school)
      WHEN p.location IS NOT NULL AND p.location = v_user_location THEN
        CONCAT('Also from ', p.location)
      WHEN EXISTS (
        SELECT 1 FROM public.follows f1
        INNER JOIN public.follows f2 ON f1.following_id = f2.following_id
        WHERE f1.follower_id = p_user_profile_id
          AND f2.follower_id = p.id
          AND f1.status = 'accepted'
          AND f2.status = 'accepted'
        LIMIT 1
      ) THEN
        'Has mutual connections'
      ELSE
        'Suggested for you'
    END AS reason
  FROM public.profiles p
  WHERE p.id != p_user_profile_id
    -- Only public profiles
    AND p.visibility = 'public'
    -- Exclude profiles already being followed or with pending requests
    AND NOT EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = p_user_profile_id
        AND f.following_id = p.id
    )
    -- Exclude previously dismissed suggestions
    AND NOT EXISTS (
      SELECT 1 FROM public.connection_suggestions cs
      WHERE cs.profile_id = p_user_profile_id
        AND cs.suggested_profile_id = p.id
        AND cs.dismissed = true
    )
  ORDER BY similarity_score DESC, p.created_at DESC
  LIMIT p_suggestion_limit;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_actor_display_name(p_profile_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_name TEXT;
BEGIN
  SELECT COALESCE(
    NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
    full_name,
    'Someone'
  )
  INTO v_name
  FROM public.profiles
  WHERE id = p_profile_id;

  RETURN COALESCE(v_name, 'Someone');
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_conversation_list(p_user_id uuid, p_limit integer DEFAULT NULL::integer, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH my_convs AS (
    SELECT cp.conversation_id, cp.last_read_at, cp.joined_at
    FROM public.conversation_participants cp
    WHERE cp.profile_id = p_user_id
      AND cp.left_at IS NULL
      AND cp.held_at IS NULL            -- 131: held children see nothing
  )
  SELECT COALESCE(jsonb_agg(sub.conv_json ORDER BY sub.updated_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      c.updated_at,
      jsonb_build_object(
        'id', c.id,
        'type', c.type,
        'name', c.name,
        'avatar_url', c.avatar_url,
        'created_by', c.created_by,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        -- All active participants (for avatars/names; the client derives the
        -- "other" participant of a DM from this). held_at exposed (131) so
        -- the SENDER can render the "waiting for approval" chip.
        'participants', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', pp.id,
            'conversation_id', pp.conversation_id,
            'profile_id', pp.profile_id,
            'role', pp.role,
            'last_read_at', pp.last_read_at,
            'is_muted', pp.is_muted,
            'joined_at', pp.joined_at,
            'left_at', pp.left_at,
            'held_at', pp.held_at,
            'profile', jsonb_build_object(
              'id', pr.id,
              'first_name', pr.first_name,
              'last_name', pr.last_name,
              'full_name', pr.full_name,
              'avatar_url', pr.avatar_url,
              'handle', pr.handle
            )
          ))
          FROM public.conversation_participants pp
          JOIN public.profiles pr ON pr.id = pp.profile_id
          WHERE pp.conversation_id = c.id
            AND pp.left_at IS NULL
        ), '[]'::jsonb),
        -- Latest non-deleted message, with its sender's profile.
        'last_message', (
          SELECT jsonb_build_object(
            'id', m.id,
            'conversation_id', m.conversation_id,
            'sender_id', m.sender_id,
            'type', m.type,
            'content', m.content,
            'media_url', m.media_url,
            'media_type', m.media_type,
            'shared_post_id', m.shared_post_id,
            'shared_profile_id', m.shared_profile_id,
            'deleted_at', m.deleted_at,
            'created_at', m.created_at,
            'updated_at', m.updated_at,
            'sender', jsonb_build_object(
              'id', sp.id,
              'first_name', sp.first_name,
              'last_name', sp.last_name,
              'full_name', sp.full_name,
              'avatar_url', sp.avatar_url,
              'handle', sp.handle
            )
          )
          FROM public.messages m
          JOIN public.profiles sp ON sp.id = m.sender_id
          WHERE m.conversation_id = c.id
            AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC
          LIMIT 1
        ),
        -- Messages from OTHERS after the unread floor (later of last_read_at
        -- and joined_at). GREATEST ignores NULLs → null last_read_at = joined_at.
        'unread_count', (
          SELECT count(*)
          FROM public.messages um
          WHERE um.conversation_id = c.id
            AND um.sender_id <> p_user_id
            AND um.deleted_at IS NULL
            AND (
              GREATEST(mc.last_read_at, mc.joined_at) IS NULL
              OR um.created_at > GREATEST(mc.last_read_at, mc.joined_at)
            )
        ),
        'my_participant', jsonb_build_object(
          'id', myp.id,
          'conversation_id', myp.conversation_id,
          'profile_id', myp.profile_id,
          'role', myp.role,
          'last_read_at', myp.last_read_at,
          'is_muted', myp.is_muted,
          'joined_at', myp.joined_at,
          'left_at', myp.left_at,
          'held_at', myp.held_at,
          'profile', jsonb_build_object(
            'id', mypr.id,
            'first_name', mypr.first_name,
            'last_name', mypr.last_name,
            'full_name', mypr.full_name,
            'avatar_url', mypr.avatar_url,
            'handle', mypr.handle
          )
        )
      ) AS conv_json
    FROM my_convs mc
    JOIN public.conversations c ON c.id = mc.conversation_id
    JOIN public.conversation_participants myp
      ON myp.conversation_id = c.id
     AND myp.profile_id = p_user_id
     AND myp.left_at IS NULL
     AND myp.held_at IS NULL            -- 131 (mirror of my_convs)
    JOIN public.profiles mypr ON mypr.id = p_user_id
    WHERE (p_before IS NULL OR c.updated_at < p_before)
    ORDER BY c.updated_at DESC
    LIMIT p_limit
  ) sub;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_golf_round_years(p_profile_id uuid)
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(array_agg(y ORDER BY y DESC), '{}')
  FROM (
    SELECT DISTINCT (substring(r.date::text, 1, 4))::int AS y
    FROM public.golf_rounds r
    WHERE r.profile_id = p_profile_id
      AND r.date IS NOT NULL
  ) t;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_golf_scorecard(p_group_post_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'golf_data', (
      SELECT row_to_json(gd)
      FROM (
        SELECT
          course_name,
          round_type,
          holes_played,
          tee_color,
          slope_rating,
          course_rating,
          weather_conditions,
          temperature,
          wind_speed
        FROM public.golf_scorecard_data
        WHERE group_post_id = p_group_post_id
      ) gd
    ),
    'participant_scores', (
      SELECT json_agg(
        json_build_object(
          'participant_id', gpp.id,
          'profile_id', gpp.profile_id,
          'profile', (
            SELECT row_to_json(p)
            FROM (
              SELECT id, full_name, first_name, last_name, avatar_url
              FROM public.profiles
              WHERE id = gpp.profile_id
            ) p
          ),
          'status', gpp.status,
          'total_score', gps.total_score,
          'to_par', gps.to_par,
          'holes_completed', gps.holes_completed,
          'scores_confirmed', gps.scores_confirmed,
          'hole_scores', (
            -- ORDER BY lives INSIDE the aggregate; see the header note. At
            -- query level (as 004 had it) this raises 42803.
            SELECT json_object_agg(
              ghs.hole_number,
              json_build_object(
                'strokes', ghs.strokes,
                'putts', ghs.putts,
                'fairway_hit', ghs.fairway_hit,
                'green_in_regulation', ghs.green_in_regulation
              )
              ORDER BY ghs.hole_number
            )
            FROM public.golf_hole_scores ghs
            WHERE ghs.golf_participant_id = gps.id
          )
        )
        ORDER BY gpp.created_at
      )
      FROM public.group_post_participants gpp
      LEFT JOIN public.golf_participant_scores gps ON gps.participant_id = gpp.id
      WHERE gpp.group_post_id = p_group_post_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_group_post_details(p_group_post_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'group_post', (
      SELECT row_to_json(gp)
      FROM (
        SELECT
          id,
          creator_id,
          type,
          title,
          description,
          date,
          location,
          visibility,
          status,
          post_id,
          created_at,
          updated_at
        FROM public.group_posts
        WHERE id = p_group_post_id
      ) gp
    ),
    'participants', (
      SELECT json_agg(
        json_build_object(
          'id', gpp.id,
          'profile_id', gpp.profile_id,
          'profile', (
            SELECT row_to_json(p)
            FROM (
              SELECT id, full_name, first_name, last_name, avatar_url, sport, school
              FROM public.profiles
              WHERE id = gpp.profile_id
            ) p
          ),
          'status', gpp.status,
          'role', gpp.role,
          'attested_at', gpp.attested_at,
          'data_contributed', gpp.data_contributed,
          'last_contribution', gpp.last_contribution
        )
        ORDER BY gpp.created_at
      )
      FROM public.group_post_participants gpp
      WHERE gpp.group_post_id = p_group_post_id
    ),
    'media', (
      SELECT json_agg(
        json_build_object(
          'id', gpm.id,
          'media_url', gpm.media_url,
          'media_type', gpm.media_type,
          'caption', gpm.caption,
          'uploaded_by', gpm.uploaded_by,
          'created_at', gpm.created_at
        )
        ORDER BY gpm.position, gpm.created_at
      )
      FROM public.group_post_media gpm
      WHERE gpm.group_post_id = p_group_post_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_pending_requests_count(target_profile_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM public.follows
  WHERE following_id = target_profile_id
  AND status = 'pending';

  RETURN v_count;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_profile_all_media(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid, media_limit integer DEFAULT 20, media_offset integer DEFAULT 0, filter_sport_keys text[] DEFAULT NULL::text[], filter_years integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, caption text, sport_key text, stats_data jsonb, round_id uuid, visibility text, created_at timestamp with time zone, profile_id uuid, profile_first_name text, profile_last_name text, profile_full_name text, profile_avatar_url text, media_count bigint, likes_count integer, comments_count integer, saves_count integer, tags text[], hashtags text[], is_own_post boolean, is_tagged boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id, p.caption, p.sport_key, p.stats_data, p.round_id, p.visibility,
      p.created_at, p.profile_id,
      prof.first_name AS profile_first_name, prof.last_name AS profile_last_name,
      prof.full_name AS profile_full_name, prof.avatar_url AS profile_avatar_url,
      (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
      p.likes_count, p.comments_count, COALESCE(p.saves_count, 0) AS saves_count,
      p.tags, p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      p.profile_id = target_profile_id
      OR p.tags @> ARRAY[target_profile_id::TEXT]
    )
    -- 074: MEDIA inverse predicate — statements moved to
    -- get_profile_statements_media; together they partition the old set.
    AND (
      (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
      OR p.round_id IS NOT NULL
      OR p.group_post_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
    )
    AND (
      p.visibility = 'public'
      OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
      OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
      OR (
        viewer_id IS NOT NULL
        AND p.visibility = 'private'
        AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = viewer_id
          AND f.following_id = p.profile_id
          AND f.status = 'accepted'
        )
      )
    )
    -- Post-OWNER visibility (mirrors 066's get_profile_tagged_media)
    AND (
      prof.visibility = 'public'
      OR (viewer_id IS NOT NULL AND (
        viewer_id = p.profile_id
        OR viewer_id = target_profile_id
        OR EXISTS (
          SELECT 1 FROM follows f2
          WHERE f2.follower_id = viewer_id
          AND f2.following_id = p.profile_id
          AND f2.status = 'accepted'
        )
      ))
    )
    AND (p.status = 'published'
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_profile_media_counts(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(all_media_count bigint, stats_media_count bigint, tagged_media_count bigint, statements_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR p.tags @> ARRAY[target_profile_id::TEXT]
      )
      -- 074: MEDIA inverse predicate — must match get_profile_all_media
      -- above, or the badge and the grid disagree (the 068 drift).
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
        OR p.group_post_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = p.id)
      )
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
      -- Post-owner visibility (mirrors the tagged subquery below)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS all_media_count,
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR p.tags @> ARRAY[target_profile_id::TEXT]
      )
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
        -- 070: must match get_profile_stats_media, or the badge and the
        -- grid disagree — the exact drift 068 was written to fix.
        OR p.group_post_id IS NOT NULL
      )
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
      -- Post-owner visibility (mirrors the tagged subquery below)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS stats_media_count,
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE p.tags @> ARRAY[target_profile_id::TEXT]
      AND p.profile_id != target_profile_id
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
      -- Post-owner visibility (mirrors get_profile_tagged_media)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS tagged_media_count,
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR p.tags @> ARRAY[target_profile_id::TEXT]
      )
      -- 074: STATEMENT predicate — must match get_profile_statements_media
      -- above (born together, drift never).
      AND (p.stats_data IS NULL OR p.stats_data = '{}'::jsonb)
      AND p.round_id IS NULL
      AND p.group_post_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = p.id)
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
      -- Post-owner visibility (mirrors the tagged subquery above)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS statements_count;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_profile_post_sport_keys(p_profile_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(array_agg(DISTINCT p.sport_key), '{}')
  FROM public.posts p
  WHERE p.profile_id = p_profile_id
    AND p.sport_key IS NOT NULL;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_profile_statements_media(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid, media_limit integer DEFAULT 20, media_offset integer DEFAULT 0, filter_sport_keys text[] DEFAULT NULL::text[], filter_years integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, caption text, sport_key text, stats_data jsonb, round_id uuid, visibility text, created_at timestamp with time zone, profile_id uuid, profile_first_name text, profile_last_name text, profile_full_name text, profile_avatar_url text, media_count bigint, likes_count integer, comments_count integer, saves_count integer, tags text[], hashtags text[], is_own_post boolean, is_tagged boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id, p.caption, p.sport_key, p.stats_data, p.round_id, p.visibility,
      p.created_at, p.profile_id,
      prof.first_name AS profile_first_name, prof.last_name AS profile_last_name,
      prof.full_name AS profile_full_name, prof.avatar_url AS profile_avatar_url,
      (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
      p.likes_count, p.comments_count, COALESCE(p.saves_count, 0) AS saves_count,
      p.tags, p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      p.profile_id = target_profile_id
      OR p.tags @> ARRAY[target_profile_id::TEXT]
    )
    -- 074: STATEMENT predicate — text-only posts only
    AND (p.stats_data IS NULL OR p.stats_data = '{}'::jsonb)
    AND p.round_id IS NULL
    AND p.group_post_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
    AND (
      p.visibility = 'public'
      OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
      OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
      OR (
        viewer_id IS NOT NULL
        AND p.visibility = 'private'
        AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = viewer_id
          AND f.following_id = p.profile_id
          AND f.status = 'accepted'
        )
      )
    )
    -- Post-OWNER visibility (mirrors 066's get_profile_tagged_media)
    AND (
      prof.visibility = 'public'
      OR (viewer_id IS NOT NULL AND (
        viewer_id = p.profile_id
        OR viewer_id = target_profile_id
        OR EXISTS (
          SELECT 1 FROM follows f2
          WHERE f2.follower_id = viewer_id
          AND f2.following_id = p.profile_id
          AND f2.status = 'accepted'
        )
      ))
    )
    AND (p.status = 'published'
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_profile_stats_media(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid, media_limit integer DEFAULT 20, media_offset integer DEFAULT 0, filter_sport_keys text[] DEFAULT NULL::text[], filter_years integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, caption text, sport_key text, stats_data jsonb, round_id uuid, visibility text, created_at timestamp with time zone, profile_id uuid, profile_first_name text, profile_last_name text, profile_full_name text, profile_avatar_url text, media_count bigint, likes_count integer, comments_count integer, saves_count integer, tags text[], hashtags text[], is_own_post boolean, is_tagged boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id, p.caption, p.sport_key, p.stats_data, p.round_id, p.visibility,
      p.created_at, p.profile_id,
      prof.first_name AS profile_first_name, prof.last_name AS profile_last_name,
      prof.full_name AS profile_full_name, prof.avatar_url AS profile_avatar_url,
      (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
      p.likes_count, p.comments_count, COALESCE(p.saves_count, 0) AS saves_count,
      p.tags, p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      (p.profile_id = target_profile_id OR p.tags @> ARRAY[target_profile_id::TEXT])
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
        -- 070: shared (multi-player) rounds carry neither stats_data nor
        -- round_id; their scores live in golf_scorecard_data.
        OR p.group_post_id IS NOT NULL
      )
    )
    AND (
      p.visibility = 'public'
      OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
      OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
      OR (
        viewer_id IS NOT NULL
        AND p.visibility = 'private'
        AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = viewer_id
          AND f.following_id = p.profile_id
          AND f.status = 'accepted'
        )
      )
    )
    -- Post-OWNER visibility (mirrors 066's get_profile_tagged_media)
    AND (
      prof.visibility = 'public'
      OR (viewer_id IS NOT NULL AND (
        viewer_id = p.profile_id
        OR viewer_id = target_profile_id
        OR EXISTS (
          SELECT 1 FROM follows f2
          WHERE f2.follower_id = viewer_id
          AND f2.following_id = p.profile_id
          AND f2.status = 'accepted'
        )
      ))
    )
    AND (p.status = 'published'
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_profile_tagged_media(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid, media_limit integer DEFAULT 20, media_offset integer DEFAULT 0, filter_sport_keys text[] DEFAULT NULL::text[], filter_years integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, caption text, sport_key text, stats_data jsonb, round_id uuid, visibility text, created_at timestamp with time zone, profile_id uuid, profile_first_name text, profile_last_name text, profile_full_name text, profile_avatar_url text, media_count bigint, likes_count integer, comments_count integer, saves_count integer, tags text[], hashtags text[], is_own_post boolean, is_tagged boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id, p.caption, p.sport_key, p.stats_data, p.round_id, p.visibility,
      p.created_at, p.profile_id,
      prof.first_name AS profile_first_name, prof.last_name AS profile_last_name,
      prof.full_name AS profile_full_name, prof.avatar_url AS profile_avatar_url,
      (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
      p.likes_count, p.comments_count, COALESCE(p.saves_count, 0) AS saves_count,
      p.tags, p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      p.tags @> ARRAY[target_profile_id::TEXT]
      AND p.profile_id != target_profile_id
    )
    -- Post-level visibility (unchanged from 051)
    AND (
      p.visibility = 'public'
      OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
      OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
      OR (
        viewer_id IS NOT NULL
        AND p.visibility = 'private'
        AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = viewer_id
          AND f.following_id = p.profile_id
          AND f.status = 'accepted'
        )
      )
    )
    -- Post-OWNER visibility (the 021 hardening, finally): a private author's
    -- posts are shown only to the author, the tagged athlete, or the
    -- author's accepted followers.
    AND (
      prof.visibility = 'public'
      OR (viewer_id IS NOT NULL AND (
        viewer_id = p.profile_id
        OR viewer_id = target_profile_id
        OR EXISTS (
          SELECT 1 FROM follows f2
          WHERE f2.follower_id = viewer_id
          AND f2.following_id = p.profile_id
          AND f2.status = 'accepted'
        )
      ))
    )
    AND (p.status = 'published'
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_profile_tagged_summary(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(times_tagged bigint, tagger_count bigint, sport_keys text[], years integer[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT p.id) AS times_tagged,
    COUNT(DISTINCT p.profile_id) AS tagger_count,
    COALESCE(array_agg(DISTINCT p.sport_key) FILTER (WHERE p.sport_key IS NOT NULL), '{}') AS sport_keys,
    COALESCE(array_agg(DISTINCT EXTRACT(YEAR FROM p.created_at)::INT) FILTER (WHERE p.id IS NOT NULL), '{}') AS years
  FROM posts p
  INNER JOIN profiles prof ON p.profile_id = prof.id
  WHERE (
    p.tags @> ARRAY[target_profile_id::TEXT]
    AND p.profile_id != target_profile_id
  )
  AND (
    p.visibility = 'public'
    OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
    OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
    OR (
      viewer_id IS NOT NULL
      AND p.visibility = 'private'
      AND EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = viewer_id
        AND f.following_id = p.profile_id
        AND f.status = 'accepted'
      )
    )
  )
  AND (
    prof.visibility = 'public'
    OR (viewer_id IS NOT NULL AND (
      viewer_id = p.profile_id
      OR viewer_id = target_profile_id
      OR EXISTS (
        SELECT 1 FROM follows f2
        WHERE f2.follower_id = viewer_id
        AND f2.following_id = p.profile_id
        AND f2.status = 'accepted'
      )
    ))
  )
  AND (p.status = 'published'
       OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id));
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_tagged_posts(target_profile_id uuid, current_user_id uuid DEFAULT NULL::uuid, page_limit integer DEFAULT 20, page_offset integer DEFAULT 0)
 RETURNS TABLE(post_id uuid, tag_id uuid, tag_created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    pt.post_id,
    pt.id as tag_id,
    pt.created_at as tag_created_at
  FROM post_tags pt
  INNER JOIN posts p ON p.id = pt.post_id
  WHERE pt.tagged_profile_id = target_profile_id
    AND pt.status = 'active'
    AND (
      -- Show if post is public
      p.visibility = 'public'
      -- Or if current user is the tagged person
      OR current_user_id = target_profile_id
      -- Or if current user is the post owner
      OR current_user_id = p.profile_id
    )
  ORDER BY pt.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_unread_message_count(p_user_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT count(*)
  FROM public.conversation_participants cp
  JOIN public.messages m
    ON m.conversation_id = cp.conversation_id
  WHERE cp.profile_id = p_user_id
    AND cp.left_at IS NULL
    AND cp.held_at IS NULL              -- 131
    AND m.sender_id <> p_user_id
    AND m.deleted_at IS NULL
    AND m.created_at > GREATEST(
      COALESCE(cp.last_read_at, cp.joined_at, '-infinity'::timestamptz),
      COALESCE(cp.joined_at, '-infinity'::timestamptz)
    );
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- The parameter is named `user_id` and so is the column, so the parameter
  -- MUST be qualified with the function name — otherwise `user_id = user_id`
  -- compares the column to itself and every row matches.
  SELECT COUNT(*)::integer
    INTO v_count
    FROM public.notifications n
   WHERE n.user_id = get_unread_notification_count.user_id
     AND n.is_read = FALSE;

  RETURN COALESCE(v_count, 0);
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.golf_course_location_facets(p_country_code text DEFAULT NULL::text)
 RETURNS TABLE(country text, country_code text, region text, region_code text, n bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    min(c.country) AS country,
    c.country_code,
    CASE WHEN p_country_code IS NULL THEN NULL ELSE min(c.region) END AS region,
    CASE WHEN p_country_code IS NULL THEN NULL ELSE c.region_code END AS region_code,
    count(*) AS n
  FROM golf_courses c
  WHERE c.country_code IS NOT NULL
    AND (p_country_code IS NULL OR (c.country_code = upper(p_country_code) AND c.region_code IS NOT NULL))
  GROUP BY c.country_code, CASE WHEN p_country_code IS NULL THEN NULL ELSE c.region_code END
  ORDER BY n DESC, 1, 3
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.golf_courses_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.club_name)), 'B') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.city)), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.region, NEW.region_code, NEW.country, NEW.country_code,
                public.place_context(NEW.place_id)))), 'D');
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.grant_guardian_access(p_profile uuid, p_new_guardian uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF (
    SELECT count(*) FROM public.profile_access
    WHERE profile_id = p_profile AND role = 'guardian'
  ) >= 2 THEN
    RAISE EXCEPTION 'profile % already has the maximum of 2 guardians', p_profile;
  END IF;

  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (p_new_guardian, p_profile, 'guardian', p_actor)
  ON CONFLICT (user_id, profile_id) DO NOTHING;

  INSERT INTO public.profile_access_audit (profile_id, user_id, action, new_role, actor_id)
  VALUES (p_profile, p_new_guardian, 'granted', 'guardian', p_actor);
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.has_profile_access(p_profile_id uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_access
    WHERE profile_id = p_profile_id
      AND user_id = (select auth.uid())
      AND role = ANY (p_roles)
  );
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.hole_score_group_post(gps_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT gpp.group_post_id
  FROM public.golf_participant_scores gps
  JOIN public.group_post_participants gpp ON gpp.id = gps.participant_id
  WHERE gps.id = gps_id;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.increment_comment_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.post_comments
  SET likes_count = likes_count + 1
  WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.increment_post_save_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.posts
  SET saves_count = saves_count + 1
  WHERE id = NEW.post_id;
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id uuid, user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = conv_id
      AND profile_id = user_id
      AND left_at IS NULL
      AND held_at IS NULL
  );
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.is_group_post_creator(gp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.group_posts
    WHERE id = gp_id AND creator_id = auth.uid()
  );
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.is_group_post_organizer(gp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.group_post_participants
    WHERE group_post_id = gp_id AND profile_id = auth.uid()
      AND role IN ('creator', 'organizer')
  );
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.is_group_post_participant(gp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.group_post_participants
    WHERE group_post_id = gp_id AND profile_id = auth.uid()
  );
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.is_valid_handle(input_handle text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  clean_handle TEXT;
BEGIN
  -- Trim and lowercase
  clean_handle := LOWER(TRIM(input_handle));

  -- Check length (3-20 characters)
  IF LENGTH(clean_handle) < 3 OR LENGTH(clean_handle) > 20 THEN
    RETURN FALSE;
  END IF;

  -- Check format: letters, numbers, dots, underscores only
  -- Must start with letter or number
  IF NOT clean_handle ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$' THEN
    RETURN FALSE;
  END IF;

  -- No consecutive dots or underscores
  IF clean_handle ~ '[._]{2,}' THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_comment_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_actor_name TEXT;
        v_comment_author UUID;
      BEGIN
        -- SCHEMA-QUALIFIED post_comments table
        SELECT profile_id INTO v_comment_author FROM public.post_comments WHERE id = NEW.comment_id;
        IF v_comment_author = NEW.profile_id THEN RETURN NEW; END IF;

        -- SCHEMA-QUALIFIED profiles table
        SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
        INTO v_actor_name FROM public.profiles WHERE id = NEW.profile_id;

        -- SCHEMA-QUALIFIED function call
        PERFORM public.create_notification(
          p_user_id := v_comment_author,
          p_type := 'like',
          p_actor_id := NEW.profile_id,
          p_title := v_actor_name || ' liked your comment',
          p_action_url := '/feed?comment=' || NEW.comment_id,
          p_comment_id := NEW.comment_id,
          p_metadata := jsonb_build_object('comment_id', NEW.comment_id)
        );
        RETURN NEW;
      END;
      $function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_follow_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    v_actor_name := public.get_actor_display_name(NEW.following_id);

    PERFORM public.create_notification(
      p_user_id := NEW.follower_id,
      p_type := 'follow_accepted',
      p_actor_id := NEW.following_id,
      p_title := v_actor_name || ' accepted your follow request',
      p_action_url := '/athlete/' || NEW.following_id,
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_follow_declined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Update the follow_request notification status when request is deleted
  IF OLD.status = 'pending' THEN
    UPDATE public.notifications
    SET action_status = 'declined',
        action_taken_at = NOW()
    WHERE follow_id = OLD.id
      AND type = 'follow_request';
  END IF;
  RETURN OLD;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_follow_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'pending' THEN
    v_actor_name := public.get_actor_display_name(NEW.follower_id);

    PERFORM public.create_notification(
      p_user_id := NEW.following_id,
      p_type := 'follow_request',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' sent you a follow request',
      p_message := NEW.message,
      p_action_url := '/app/followers?tab=requests',
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id, 'action_status', 'pending')
    );
  END IF;
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_new_follower()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'accepted' THEN
    v_actor_name := public.get_actor_display_name(NEW.follower_id);

    PERFORM public.create_notification(
      p_user_id := NEW.following_id,
      p_type := 'new_follower',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' started following you',
      p_action_url := '/athlete/' || NEW.follower_id,
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_post_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_post_owner UUID;
  v_actor_name TEXT;
BEGIN
  -- Held/rejected comments are invisible: no notification until approval
  -- (the app sends it when a guardian approves).
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  SELECT profile_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
  IF v_post_owner IS NULL OR v_post_owner = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  v_actor_name := public.get_actor_display_name(NEW.profile_id);

  PERFORM public.create_notification(
    p_user_id := v_post_owner,
    p_type := 'comment',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' commented on your post',
    p_action_url := '/feed',
    p_post_id := NEW.post_id,
    p_comment_id := NEW.id,
    p_metadata := jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id)
  );
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_post_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    DECLARE
      v_post_owner UUID;
      v_actor_name TEXT;
    BEGIN
      SELECT profile_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
      IF v_post_owner IS NULL OR v_post_owner = NEW.profile_id THEN
        RETURN NEW;
      END IF;

      v_actor_name := public.get_actor_display_name(NEW.profile_id);

      PERFORM public.create_notification(
        p_user_id := v_post_owner,
        p_type := 'like',
        p_actor_id := NEW.profile_id,
        p_title := v_actor_name || ' liked your post',
        p_action_url := '/feed',
        p_post_id := NEW.post_id,
        p_metadata := jsonb_build_object('post_id', NEW.post_id)
      );
      RETURN NEW;
    END;
    $function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_profile_tagged()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_name TEXT;
BEGIN
  -- Don't notify if tagging yourself (create_notification also guards this)
  IF NEW.tagged_profile_id = NEW.created_by_profile_id THEN
    RETURN NEW;
  END IF;

  -- Actor display name, same convention as migration 014
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = NEW.created_by_profile_id;

  PERFORM public.create_notification(
    p_user_id   := NEW.tagged_profile_id,
    p_type      := 'tag',
    p_actor_id  := NEW.created_by_profile_id,
    p_title     := v_actor_name || ' tagged you in a post',
    p_action_url := '/feed?post=' || NEW.post_id,
    p_post_id   := NEW.post_id,
    p_metadata  := jsonb_build_object('tag_id', NEW.id, 'media_id', NEW.media_id)
  );

  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.organizations_kind_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'organizations.kind is immutable (% → %)', OLD.kind, NEW.kind USING ERRCODE = 'check_violation';
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.organizations_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.description)), 'B') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.city, NEW.sport_key, NEW.location))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.region, NEW.region_code, NEW.country, NEW.country_code))), 'D') ||
    setweight(to_tsvector('simple', public.search_normalize(
      public.place_context(NEW.place_id))), 'D');
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.participant_group_post(p_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT group_post_id FROM public.group_post_participants WHERE id = p_id;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.place_context(p_place_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT concat_ws(' ', p.admin2, p.metro) FROM places p WHERE p.id = p_place_id
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.place_fields(p_place_id uuid)
 RETURNS TABLE(city text, region text, region_code text, country text, country_code text, lat double precision, lng double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT p.name, p.region, p.region_code, p.country, p.country_code, p.lat, p.lng
  FROM places p WHERE p.id = p_place_id
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.places_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.ascii_name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(concat_ws(' ', NEW.region, NEW.region_code))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(concat_ws(' ', NEW.country, NEW.country_code))), 'D');
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.posts_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', COALESCE(NEW.caption, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.hashtags, ' '), '')), 'B');
  RETURN NEW;
END; $function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.profiles_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.first_name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.last_name)),  'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.full_name)),  'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.handle)),     'B') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.location))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(public.place_context(NEW.place_id))), 'D');
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.provenance_inventory()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'version', 1,
      'generated_at', now(),
      'role', current_user,
      'server_version', current_setting('server_version')
    ),
    'rls', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname,
               'enabled', c.relrowsecurity,
               'forced', c.relforcerowsecurity
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', p.tablename,
               'name', p.policyname,
               'permissive', p.permissive,
               'roles', to_jsonb(p.roles),
               'cmd', p.cmd,
               'qual', p.qual,
               'with_check', p.with_check
             ) ORDER BY p.tablename, p.policyname), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
    ),
    'functions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', p.proname,
               'identity_args', pg_get_function_identity_arguments(p.oid),
               'arg_types', oidvectortypes(p.proargtypes),
               'returns', pg_get_function_result(p.oid),
               'kind', p.prokind,
               'language', l.lanname,
               'volatility', p.provolatile,
               'secdef', p.prosecdef,
               'config', to_jsonb(p.proconfig),
               'body_md5', md5(p.prosrc),
               'body_md5_norm', md5(btrim(
                 regexp_replace(
                   regexp_replace(p.prosrc, E'\r\n', E'\n', 'g'),
                   E'[ \t]+\n', E'\n', 'g'),
                 E' \t\n')),
               'body_bytes', length(p.prosrc),
               'definition', pg_get_functiondef(p.oid),
               'acl', to_jsonb(p.proacl),
               'owner', pg_get_userbyid(p.proowner)
             ) ORDER BY p.proname, oidvectortypes(p.proargtypes)), '[]'::jsonb)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language  l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass
            AND d.objid = p.oid
            AND d.deptype = 'e'
        )
    ),
    'triggers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname,
               'name', t.tgname,
               'enabled', t.tgenabled,
               'definition', pg_get_triggerdef(t.oid)
             ) ORDER BY c.relname, t.tgname), '[]'::jsonb)
      FROM pg_trigger t
      JOIN pg_class c     ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
    )
  );
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
 RETURNS TABLE(allowed boolean, retry_after_seconds integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  -- Opportunistic GC on ~1% of calls: rows are one per active key, so the
  -- table stays at hundreds of rows and this needs no cron. 2 days is
  -- comfortably past the longest window (1 day), so it only touches cold
  -- rows and never contends with a hot key's row lock.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 days';
  END IF;

  -- One atomic upsert: concurrent callers serialize on the row lock, so no
  -- lost increments and no double window-reset. While blocked, count keeps
  -- climbing but window_start does NOT move — the window still expires on
  -- schedule (no punishment-extension).
  INSERT INTO public.rate_limits AS rl (key, window_start, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN rl.window_start <= now() - make_interval(secs => p_window_seconds)
      THEN 1 ELSE rl.count + 1 END,
    window_start = CASE
      WHEN rl.window_start <= now() - make_interval(secs => p_window_seconds)
      THEN now() ELSE rl.window_start END
  RETURNING rl.count, rl.window_start INTO v_count, v_window_start;

  allowed := v_count <= p_max;
  retry_after_seconds := CASE WHEN v_count <= p_max THEN 0
    ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM
      (v_window_start + make_interval(secs => p_window_seconds) - now())))::integer)
  END;
  RETURN NEXT;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.resolve_org_site_domain(p_slug text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT custom_domain
  FROM org_sites
  WHERE subdomain = lower(p_slug)
    AND domain_active_at IS NOT NULL
    AND published_at IS NOT NULL
  LIMIT 1
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.resolve_org_site_host(p_host text)
 RETURNS TABLE(slug text, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT subdomain, domain_active_at IS NOT NULL
  FROM org_sites
  WHERE custom_domain = lower(p_host)
    AND domain_verified_at IS NOT NULL
    AND published_at IS NOT NULL
  LIMIT 1
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.schema_dump()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_buckets jsonb;
  v_cron    jsonb;
  v_seed    jsonb;
  v_ledger  jsonb;
BEGIN
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', b.id, 'name', b.name, 'public', b.public,
             'file_size_limit', b.file_size_limit, 'allowed_mime_types', to_jsonb(b.allowed_mime_types)
           ) ORDER BY b.id), '[]'::jsonb)
      INTO v_buckets
      FROM storage.buckets b;
  EXCEPTION WHEN OTHERS THEN
    v_buckets := NULL;
  END;

  -- The cron commands carry a live bearer token (059 / 135 were run with
  -- CRON_SECRET pasted in): REDACTED here, so the secret never leaves the
  -- database — the rebuild carries the placeholder the files carry.
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
             'command', regexp_replace(j.command, 'Bearer [^''"\s]+', 'Bearer __CRON_SECRET__', 'g')
           ) ORDER BY j.jobname), '[]'::jsonb)
      INTO v_cron
      FROM cron.job j;
  EXCEPTION WHEN OTHERS THEN
    v_cron := NULL;
  END;

  -- Reference rows the app cannot run without. ONE table today:
  -- reserved_handles (the root-segment + system-path seed, 006 onward).
  -- `sports` is empty on prod (the registry lives in code); the golf
  -- catalog is DATA (28k courses), copied separately, never a baseline.
  BEGIN
    SELECT jsonb_build_object(
             'reserved_handles', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.handle), '[]'::jsonb) FROM public.reserved_handles r)
           )
      INTO v_seed;
  EXCEPTION WHEN OTHERS THEN
    v_seed := NULL;
  END;

  BEGIN
    SELECT jsonb_build_object('head', max(m.number), 'rows', count(*))
      INTO v_ledger
      FROM public.schema_migrations m;
  EXCEPTION WHEN OTHERS THEN
    v_ledger := NULL;
  END;

  RETURN jsonb_build_object(
    'meta', jsonb_build_object(
      'version', 3,
      'generated_at', now(),
      'role', current_user,
      'server_version', current_setting('server_version'),
      'ledger', v_ledger
    ),
    'extensions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', e.extname, 'schema', n.nspname, 'version', e.extversion) ORDER BY e.extname), '[]'::jsonb)
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname <> 'plpgsql'
    ),
    'types', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', t.typname,
               'labels', (SELECT jsonb_agg(l.enumlabel ORDER BY l.enumsortorder) FROM pg_enum l WHERE l.enumtypid = t.oid)
             ) ORDER BY t.typname), '[]'::jsonb)
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    ),
    'sequences', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', s.sequencename, 'data_type', s.data_type::text,
               'start', s.start_value, 'increment', s.increment_by, 'min', s.min_value, 'max', s.max_value, 'cycle', s.cycle,
               'owned_by', (
                 SELECT c.relname || '.' || a.attname
                 FROM pg_depend d
                 JOIN pg_class c ON c.oid = d.refobjid
                 JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                 WHERE d.classid = 'pg_class'::regclass AND d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass
                   AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
                 LIMIT 1
               ),
               'identity', EXISTS (
                 SELECT 1 FROM pg_depend d
                 WHERE d.classid = 'pg_class'::regclass AND d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass
                   AND d.deptype = 'i'
               ),
               'grants', jsonb_build_object(
                 'anon', has_sequence_privilege('anon', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE'),
                 'authenticated', has_sequence_privilege('authenticated', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE'),
                 'service_role', has_sequence_privilege('service_role', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE')
               )
             ) ORDER BY s.sequencename), '[]'::jsonb)
      FROM pg_sequences s
      WHERE s.schemaname = 'public'
    ),
    'tables', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', c.relname,
               'kind', c.relkind,
               'rls', c.relrowsecurity,
               'rls_forced', c.relforcerowsecurity,
               'comment', obj_description(c.oid, 'pg_class'),
               'columns', (
                 SELECT jsonb_agg(jsonb_build_object(
                          'name', a.attname,
                          'type', format_type(a.atttypid, a.atttypmod),
                          'not_null', a.attnotnull,
                          'default', pg_get_expr(d.adbin, d.adrelid),
                          'identity', a.attidentity,
                          'generated', a.attgenerated,
                          'comment', col_description(c.oid, a.attnum)
                        ) ORDER BY a.attnum)
                 FROM pg_attribute a
                 LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                 WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
               ),
               'grants', (
                 -- has_table_privilege per role × privilege: visible whoever calls
                 -- (role_table_grants showed only the CALLER's grants — 228).
                 SELECT COALESCE(jsonb_object_agg(g.grantee, g.privs), '{}'::jsonb)
                 FROM (
                   SELECT r.grantee,
                          (SELECT jsonb_agg(p.priv ORDER BY p.priv)
                             FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) AS p(priv)
                            WHERE has_table_privilege(r.grantee, c.oid, p.priv)) AS privs
                   FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(grantee)
                 ) g
                 WHERE g.privs IS NOT NULL
               )
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'constraints', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname, 'name', k.conname, 'type', k.contype,
               'definition', pg_get_constraintdef(k.oid),
               'index', (SELECT i.relname FROM pg_class i WHERE i.oid = k.conindid AND k.conindid <> 0)
             ) ORDER BY c.relname, k.contype, k.conname), '[]'::jsonb)
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'indexes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', i.tablename, 'name', i.indexname, 'definition', i.indexdef,
               'constraint', EXISTS (
                 SELECT 1 FROM pg_constraint k WHERE k.conindid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass
               )
             ) ORDER BY i.tablename, i.indexname), '[]'::jsonb)
      FROM pg_indexes i
      WHERE i.schemaname = 'public'
    ),
    'views', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', c.relname, 'materialized', c.relkind = 'm',
               'definition', pg_get_viewdef(c.oid, true),
               -- 234: the view's reloptions (security_invoker, check_option …) — pg_get_viewdef
               -- never carries them, and a rebuilt view without them is a different view.
               'options', to_jsonb(c.reloptions),
               'grants', (
                 -- has_table_privilege per role × privilege: visible whoever calls
                 -- (role_table_grants showed only the CALLER's grants — 228).
                 SELECT COALESCE(jsonb_object_agg(g.grantee, g.privs), '{}'::jsonb)
                 FROM (
                   SELECT r.grantee,
                          (SELECT jsonb_agg(p.priv ORDER BY p.priv)
                             FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) AS p(priv)
                            WHERE has_table_privilege(r.grantee, c.oid, p.priv)) AS privs
                   FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(grantee)
                 ) g
                 WHERE g.privs IS NOT NULL
               )
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ),
    'functions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', p.proname,
               'identity_args', pg_get_function_identity_arguments(p.oid),
               'kind', p.prokind,
               'language', l.lanname,
               'definition', pg_get_functiondef(p.oid),
               'grants', jsonb_build_object(
                 'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
                 'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                 'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')
               ),
               'comment', obj_description(p.oid, 'pg_proc')
             ) ORDER BY p.proname, oidvectortypes(p.proargtypes)), '[]'::jsonb)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language  l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    ),
    'triggers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schema', n.nspname, 'table', c.relname, 'name', t.tgname,
               'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid)
             ) ORDER BY n.nspname, c.relname, t.tgname), '[]'::jsonb)
      FROM pg_trigger t
      JOIN pg_class c     ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
        AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schema', p.schemaname, 'table', p.tablename, 'name', p.policyname,
               'permissive', p.permissive, 'roles', to_jsonb(p.roles), 'cmd', p.cmd,
               'qual', p.qual, 'with_check', p.with_check
             ) ORDER BY p.schemaname, p.tablename, p.policyname), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public' OR (p.schemaname = 'storage' AND p.tablename = 'objects')
    ),
    'publications', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('publication', pt.pubname, 'table', pt.tablename) ORDER BY pt.pubname, pt.tablename), '[]'::jsonb)
      FROM pg_publication_tables pt
      WHERE pt.schemaname = 'public'
    ),
    'storage_buckets', v_buckets,
    'cron_jobs', v_cron,
    'seed_rows', v_seed
  );
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_all(q text, p_types text[] DEFAULT NULL::text[], max_per_type integer DEFAULT 20, visible_ids uuid[] DEFAULT '{}'::uuid[], include_public boolean DEFAULT true, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text, p_near_lat double precision DEFAULT NULL::double precision, p_near_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS TABLE(entity_type text, entity_id uuid, title text, subtitle text, sport_key text, city text, region text, region_code text, country text, country_code text, place_id uuid, lat double precision, lng double precision, distance_km double precision, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn       text    := public.search_normalize(q);
  tsq      tsquery := public.search_prefix_tsquery(q);
  per      int     := GREATEST(COALESCE(max_per_type, 20), 1);
  near     boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius   float8  := COALESCE(p_radius_km, 50);
  filtered boolean;
  dlat     float8;
  dlng     float8;
BEGIN
  filtered := p_country_code IS NOT NULL OR p_region_code IS NOT NULL OR near;
  -- An empty query is a filtered browse or nothing (search_people precedent).
  IF qn = '' AND NOT filtered THEN RETURN; END IF;
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  WITH base AS (
    SELECT d.*,
      CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, d.lat, d.lng) END AS dist
    FROM search_documents d
    WHERE (p_types IS NULL OR d.entity_type = ANY(p_types))
      -- Privacy: public docs pass (athletes only when include_public);
      -- everything else needs the owner in the caller's audience.
      AND ( (d.visibility = 'public' AND (d.entity_type <> 'athlete' OR include_public))
            OR (d.owner_id IS NOT NULL AND d.owner_id = ANY(visible_ids)) )
      AND (p_country_code IS NULL OR d.country_code = upper(p_country_code))
      AND (p_region_code IS NULL OR d.region_code = upper(p_region_code))
      AND (NOT near OR (d.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                    AND d.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
  ),
  matched AS (
    SELECT b.*,
      CASE
        WHEN qn = '' THEN 3
        WHEN public.search_normalize(b.title) = qn THEN 0
        WHEN public.search_normalize(b.title) LIKE qn || '%' THEN 1
        WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(b.title)) @@ tsq THEN 2
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq THEN 3
        ELSE 4
      END AS tier,
      CASE WHEN tsq IS NOT NULL
           THEN public.search_token_hits(to_tsvector('simple', public.search_normalize(b.title)), q)
           ELSE 0 END AS name_hits,
      CASE WHEN tsq IS NOT NULL THEN public.search_token_rank(b.search_vector, q) ELSE 0 END AS score
    FROM base b
    WHERE qn = ''
       OR (tsq IS NOT NULL AND b.search_vector @@ tsq)
       OR (length(qn) >= 2 AND (
            b.title ILIKE '%' || qn || '%' OR b.subtitle ILIKE '%' || qn || '%'
         OR b.city ILIKE '%' || qn || '%' OR b.region ILIKE '%' || qn || '%'
         OR b.country ILIKE '%' || qn || '%'))
  ),
  ranked AS (
    SELECT m.*, ROW_NUMBER() OVER (
      PARTITION BY m.entity_type
      ORDER BY
        m.tier,
        CASE WHEN near AND qn = '' THEN m.dist END ASC NULLS LAST,
        m.name_hits DESC,
        m.rich DESC,
        m.recency DESC NULLS LAST,
        m.score DESC,
        m.dist ASC NULLS LAST,
        m.title
    ) AS rn
    FROM matched m
  )
  SELECT r.entity_type, r.entity_id, r.title, r.subtitle, r.sport_key,
    r.city, r.region, r.region_code, r.country, r.country_code,
    r.place_id, r.lat, r.lng, r.dist, r.tier
  FROM ranked r
  WHERE r.rn <= per
  ORDER BY
    r.tier,
    CASE WHEN near AND qn = '' THEN r.dist END ASC NULLS LAST,
    r.name_hits DESC,
    r.rich DESC,
    r.recency DESC NULLS LAST,
    r.score DESC,
    r.dist ASC NULLS LAST,
    r.title;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_all_facets(q text, p_types text[] DEFAULT NULL::text[], visible_ids uuid[] DEFAULT '{}'::uuid[], include_public boolean DEFAULT true, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text)
 RETURNS TABLE(facet text, code text, label text, n bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn  text    := public.search_normalize(q);
  tsq tsquery := public.search_prefix_tsquery(q);
BEGIN
  RETURN QUERY
  WITH matched AS (
    SELECT d.*
    FROM search_documents d
    WHERE (p_types IS NULL OR d.entity_type = ANY(p_types))
      AND ( (d.visibility = 'public' AND (d.entity_type <> 'athlete' OR include_public))
            OR (d.owner_id IS NOT NULL AND d.owner_id = ANY(visible_ids)) )
      AND (p_country_code IS NULL OR d.country_code = upper(p_country_code))
      AND (p_region_code IS NULL OR d.region_code = upper(p_region_code))
      AND (qn = ''
        OR (tsq IS NOT NULL AND d.search_vector @@ tsq)
        OR (length(qn) >= 2 AND (
             d.title ILIKE '%' || qn || '%' OR d.subtitle ILIKE '%' || qn || '%'
          OR d.city ILIKE '%' || qn || '%' OR d.region ILIKE '%' || qn || '%'
          OR d.country ILIKE '%' || qn || '%')))
  ),
  grouped AS (
    SELECT
      CASE
        WHEN GROUPING(m.entity_type) = 0 THEN 'type'
        WHEN GROUPING(m.sport_key) = 0 THEN 'sport'
        WHEN GROUPING(m.region_code) = 0 THEN 'region'
        ELSE 'country'
      END AS g_facet,
      CASE
        WHEN GROUPING(m.entity_type) = 0 THEN m.entity_type
        WHEN GROUPING(m.sport_key) = 0 THEN m.sport_key
        WHEN GROUPING(m.region_code) = 0 THEN m.region_code
        ELSE m.country_code
      END AS g_code,
      CASE
        WHEN GROUPING(m.entity_type) = 0 THEN m.entity_type
        WHEN GROUPING(m.sport_key) = 0 THEN m.sport_key
        WHEN GROUPING(m.region_code) = 0 THEN min(m.region)
        ELSE min(m.country)
      END AS g_label,
      count(*) AS g_n
    FROM matched m
    GROUP BY GROUPING SETS ((m.entity_type), (m.sport_key), (m.country_code, m.region_code), (m.country_code))
  ),
  ranked AS (
    SELECT g.g_facet, g.g_code, g.g_label, g.g_n,
      ROW_NUMBER() OVER (PARTITION BY g.g_facet ORDER BY g.g_n DESC, g.g_code) AS rn
    FROM grouped g
    WHERE g.g_code IS NOT NULL
  )
  SELECT r.g_facet, r.g_code, r.g_label, r.g_n
  FROM ranked r
  WHERE r.rn <= 100
  ORDER BY
    CASE r.g_facet WHEN 'type' THEN 0 WHEN 'sport' THEN 1 WHEN 'country' THEN 2 ELSE 3 END,
    r.g_n DESC,
    r.g_code;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_by_handle(search_term text, max_results integer DEFAULT 10)
 RETURNS TABLE(profile_id uuid, handle text, first_name text, last_name text, avatar_url text, sport text, school text, match_type text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  clean_term TEXT;
BEGIN
  -- Remove @ if present and clean
  clean_term := LOWER(TRIM(LEADING '@' FROM TRIM(search_term)));

  RETURN QUERY
  SELECT
    p.id,
    p.handle,
    p.first_name,
    p.last_name,
    p.avatar_url,
    p.sport,
    p.school,
    CASE
      WHEN LOWER(p.handle) = clean_term THEN 'exact'
      WHEN LOWER(p.handle) LIKE clean_term || '%' THEN 'prefix'
      ELSE 'partial'
    END AS match_type
  FROM public.profiles p
  WHERE p.handle IS NOT NULL
    AND LOWER(p.handle) LIKE '%' || clean_term || '%'
  ORDER BY
    -- Exact matches first
    CASE WHEN LOWER(p.handle) = clean_term THEN 0 ELSE 1 END,
    -- Then prefix matches
    CASE WHEN LOWER(p.handle) LIKE clean_term || '%' THEN 0 ELSE 1 END,
    -- Then by length (shorter handles rank higher)
    LENGTH(p.handle),
    -- Finally alphabetically
    p.handle
  LIMIT max_results;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_clubs(q text, max_results integer DEFAULT 20, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text, p_near_lat double precision DEFAULT NULL::double precision, p_near_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, name text, description text, location text, city text, region text, region_code text, country text, country_code text, lat double precision, lng double precision, distance_km double precision, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn     text    := public.search_normalize(q);
  tsq    tsquery := public.search_prefix_tsquery(q);
  lim    int     := GREATEST(COALESCE(max_results, 20), 1);
  near   boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius float8  := COALESCE(p_radius_km, 50);
  dlat   float8;
  dlng   float8;
BEGIN
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  SELECT c.id, c.name, c.description, c.location,
    c.city, c.region, c.region_code, c.country, c.country_code, c.lat, c.lng,
    CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END AS distance_km,
    CASE
      WHEN qn = '' THEN 3
      WHEN public.search_normalize(c.name) = qn THEN 0
      WHEN public.search_normalize(c.name) LIKE qn || '%' THEN 1
      WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(c.name)) @@ tsq THEN 2
      ELSE 3
    END AS match_rank
  FROM public.organizations c
  WHERE c.kind = 'club'
    AND (p_country_code IS NULL OR c.country_code = upper(p_country_code))
    AND (p_region_code IS NULL OR c.region_code = upper(p_region_code))
    AND (NOT near OR (c.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                  AND c.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
    AND (qn = '' OR (tsq IS NOT NULL AND c.search_vector @@ tsq)
         OR (length(qn) >= 2 AND (c.name ILIKE '%' || qn || '%' OR c.location ILIKE '%' || qn || '%')))
  ORDER BY 13,
    CASE WHEN near AND qn = '' THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END ASC NULLS LAST,
    CASE WHEN tsq IS NOT NULL THEN public.search_token_hits(to_tsvector('simple', public.search_normalize(c.name)), q) ELSE 0 END DESC,
    c.name
  LIMIT lim;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_doc_delete_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  DELETE FROM search_documents sd
  WHERE sd.entity_type = OLD.kind AND sd.entity_id = OLD.id;
  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_doc_sync_athlete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t text := COALESCE(NULLIF(btrim(COALESCE(NEW.full_name, '')), ''), NEW.handle);
BEGIN
  IF t IS NULL THEN
    DELETE FROM search_documents sd WHERE sd.entity_type = 'athlete' AND sd.entity_id = NEW.id;
    RETURN NULL;
  END IF;
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES ('athlete', NEW.id, t, NEW.handle, NULL,
    NEW.id, COALESCE(NEW.visibility, 'public'), NEW.place_id, NEW.city, NEW.region, NEW.region_code,
    NEW.country, NEW.country_code, NEW.lat, NEW.lng,
    (NEW.handle IS NOT NULL AND NEW.avatar_url IS NOT NULL),
    NEW.updated_at, COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_doc_sync_course()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES ('course', NEW.id, NEW.name, NEW.club_name, 'golf',
    NULL, 'public', NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code,
    NEW.lat, NEW.lng,
    (NEW.hole_data IS NOT NULL OR NEW.course_rating <> '{}'::jsonb),
    NEW.hydrated_at, COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_doc_sync_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES (NEW.kind, NEW.id, NEW.name, left(NEW.description, 140), NEW.sport_key,
    NULL, 'public', NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code,
    NEW.lat, NEW.lng, (NEW.description IS NOT NULL), NEW.updated_at,
    COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_doc_sync_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t text;
  author text;
BEGIN
  IF NEW.visibility = 'public' AND NEW.status = 'published' THEN
    t := left(btrim(COALESCE(NEW.caption, '')), 140);
    IF t = '' THEN
      t := left(btrim(array_to_string(COALESCE(NEW.hashtags, '{}'), ' ')), 140);
    END IF;
    IF t = '' THEN
      -- Nothing searchable: no caption, no hashtags.
      DELETE FROM search_documents sd WHERE sd.entity_type = 'post' AND sd.entity_id = NEW.id;
      RETURN NULL;
    END IF;
    SELECT p.full_name INTO author FROM profiles p WHERE p.id = NEW.profile_id;
    INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
      owner_id, visibility, place_id, city, region, region_code, country, country_code,
      lat, lng, rich, recency, search_vector)
    VALUES ('post', NEW.id, t, author, NEW.sport_key,
      NEW.profile_id, 'public', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      false, NEW.created_at,
      setweight(to_tsvector('simple', public.search_normalize(NEW.caption)), 'A') ||
      setweight(to_tsvector('simple', public.search_normalize(array_to_string(COALESCE(NEW.hashtags, '{}'), ' '))), 'B') ||
      setweight(to_tsvector('simple', public.search_normalize(NEW.sport_key)), 'C'))
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
      owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility,
      rich = EXCLUDED.rich, recency = EXCLUDED.recency,
      search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  ELSE
    DELETE FROM search_documents sd WHERE sd.entity_type = 'post' AND sd.entity_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_document_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  DELETE FROM search_documents sd
  WHERE sd.entity_type = TG_ARGV[0] AND sd.entity_id = OLD.id;
  RETURN NULL;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_golf_courses(q text, max_results integer DEFAULT 20, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text, p_near_lat double precision DEFAULT NULL::double precision, p_near_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, external_source text, external_id text, name text, club_name text, city text, region text, country text, total_par integer, holes_count integer, hole_data jsonb, course_rating jsonb, slope_rating jsonb, lat double precision, lng double precision, description text, description_attribution text, architect text, year_built integer, course_type text, website text, phone text, hydrated_at timestamp with time zone, place_id uuid, country_code text, region_code text, location_source text, distance_km double precision, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn     text    := public.search_normalize(q);
  tsq    tsquery := public.search_prefix_tsquery(q);
  lim    int     := GREATEST(COALESCE(max_results, 20), 1);
  near   boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius float8  := COALESCE(p_radius_km, 50);
  dlat   float8;
  dlng   float8;
BEGIN
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  WITH base AS (
    SELECT c.*,
      CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END AS dist
    FROM golf_courses c
    WHERE (p_country_code IS NULL OR c.country_code = upper(p_country_code))
      AND (p_region_code IS NULL OR c.region_code = upper(p_region_code))
      AND (NOT near OR (c.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                    AND c.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
  ),
  matched AS (
    SELECT b.*,
      CASE
        WHEN qn = '' THEN 3
        WHEN public.search_normalize(b.name) = qn THEN 0
        WHEN public.search_normalize(b.name) LIKE qn || '%' THEN 1
        WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(b.name)) @@ tsq THEN 2
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq THEN 3
        ELSE 4
      END AS tier,
      CASE WHEN tsq IS NOT NULL
           THEN public.search_token_hits(to_tsvector('simple', public.search_normalize(b.name)), q)
           ELSE 0 END AS name_hits,
      CASE WHEN tsq IS NOT NULL THEN public.search_token_rank(b.search_vector, q) ELSE 0 END AS score
    FROM base b
    WHERE qn = ''
       OR (tsq IS NOT NULL AND b.search_vector @@ tsq)
       OR (length(qn) >= 2 AND (
            b.name ILIKE '%' || qn || '%' OR b.club_name ILIKE '%' || qn || '%'
         OR b.city ILIKE '%' || qn || '%' OR b.region ILIKE '%' || qn || '%'
         OR b.country ILIKE '%' || qn || '%'))
  )
  SELECT m.id, m.external_source, m.external_id, m.name, m.club_name,
    m.city, m.region, m.country, m.total_par, m.holes_count,
    m.hole_data, m.course_rating, m.slope_rating,
    m.lat, m.lng, m.description, m.description_attribution,
    m.architect, m.year_built, m.course_type, m.website, m.phone,
    m.hydrated_at, m.place_id, m.country_code, m.region_code,
    m.location_source, m.dist, m.tier
  FROM matched m
  ORDER BY
    m.tier,
    CASE WHEN near AND qn = '' THEN m.dist END ASC NULLS LAST,
    -- More of the query in the NAME wins, whatever sits next to what.
    m.name_hits DESC,
    (m.hole_data IS NOT NULL OR m.course_rating <> '{}'::jsonb) DESC,
    (m.city IS NOT NULL) DESC,
    m.hydrated_at DESC NULLS LAST,
    m.score DESC,
    m.dist ASC NULLS LAST,
    m.name
  LIMIT lim;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_normalize(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$ SELECT lower(unaccent(coalesce(t, ''))) $function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_people(search_term text, visible_ids uuid[] DEFAULT '{}'::uuid[], include_public boolean DEFAULT true, max_results integer DEFAULT 20, require_handle boolean DEFAULT false, exclude_id uuid DEFAULT NULL::uuid, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text, p_near_lat double precision DEFAULT NULL::double precision, p_near_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, handle text, first_name text, middle_name text, last_name text, full_name text, avatar_url text, location text, sport text, school text, visibility text, city text, region text, region_code text, country text, country_code text, distance_km double precision, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  q        TEXT;
  q_c      TEXT;
  v_lo     TEXT;
  v_hi     TEXT;
  esc      TEXT;
  infix    TEXT;
  wordpre  TEXT;
  is_short BOOLEAN;
  tsq      TSQUERY;
  near     BOOLEAN := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius   FLOAT8  := COALESCE(p_radius_km, 50);
  filtered BOOLEAN := p_country_code IS NOT NULL OR p_region_code IS NOT NULL
                      OR (p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL);
  dlat     FLOAT8;
  dlng     FLOAT8;
BEGIN
  q := lower(btrim(ltrim(btrim(COALESCE(search_term, '')), '@')));
  -- An empty query is allowed ONLY as a filtered browse (Explore: "athletes
  -- in Ontario"); unfiltered it returns nothing, as in 087.
  IF q = '' AND NOT filtered THEN
    RETURN;
  END IF;

  q_c  := q COLLATE "C";
  v_lo := q_c;
  v_hi := (q || chr(1114111)) COLLATE "C";
  esc     := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  infix   := '%' || esc || '%';
  wordpre := '% ' || esc || '%';
  is_short := length(q) < 3;
  tsq  := public.search_prefix_tsquery(q);
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));

  RETURN QUERY
  SELECT
    p.id, p.handle, p.first_name, p.middle_name, p.last_name, p.full_name,
    p.avatar_url, p.location, p.sport, p.school, p.visibility,
    p.city, p.region, p.region_code, p.country, p.country_code,
    CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, p.lat, p.lng) END AS distance_km,
    (CASE
       WHEN q = ''                                                    THEN 5
       WHEN (lower(p.handle) COLLATE "C") = q_c                       THEN 0
       WHEN (lower(p.handle) COLLATE "C") >= v_lo
        AND (lower(p.handle) COLLATE "C") <  v_hi                     THEN 1
       WHEN ((lower(p.first_name) COLLATE "C") >= v_lo AND (lower(p.first_name) COLLATE "C") < v_hi)
         OR ((lower(p.last_name)  COLLATE "C") >= v_lo AND (lower(p.last_name)  COLLATE "C") < v_hi)
         OR ((lower(p.full_name)  COLLATE "C") >= v_lo AND (lower(p.full_name)  COLLATE "C") < v_hi)
                                                                      THEN 2
       WHEN lower(p.full_name)  LIKE wordpre
         OR lower(p.last_name)  LIKE wordpre
         OR lower(p.first_name) LIKE wordpre                          THEN 3
       WHEN NOT is_short AND (
            lower(p.handle)     LIKE infix OR lower(p.first_name) LIKE infix OR
            lower(p.last_name)  LIKE infix OR lower(p.full_name)  LIKE infix) THEN 4
       -- Location tier: every token of the query matches somewhere in the
       -- profile's vector (city, region, country, free-text location, or a
       -- name token mixed in: "sarah ottawa"). Always below name tiers.
       ELSE 5
     END)::INT AS match_rank
  FROM public.profiles p
  WHERE
    ((include_public AND p.visibility = 'public') OR p.id = ANY(visible_ids))
    AND (NOT require_handle OR p.handle IS NOT NULL)
    AND (exclude_id IS NULL OR p.id <> exclude_id)
    AND (p_country_code IS NULL OR p.country_code = upper(p_country_code))
    AND (p_region_code IS NULL OR p.region_code = upper(p_region_code))
    AND (NOT near OR (p.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                  AND p.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
    AND (
      q = '' OR
      ((lower(p.handle)     COLLATE "C") >= v_lo AND (lower(p.handle)     COLLATE "C") < v_hi) OR
      ((lower(p.first_name) COLLATE "C") >= v_lo AND (lower(p.first_name) COLLATE "C") < v_hi) OR
      ((lower(p.last_name)  COLLATE "C") >= v_lo AND (lower(p.last_name)  COLLATE "C") < v_hi) OR
      ((lower(p.full_name)  COLLATE "C") >= v_lo AND (lower(p.full_name)  COLLATE "C") < v_hi) OR
      (NOT is_short AND (
        lower(p.handle)     LIKE infix OR
        lower(p.first_name) LIKE infix OR
        lower(p.last_name)  LIKE infix OR
        lower(p.full_name)  LIKE infix
      )) OR
      (tsq IS NOT NULL AND p.search_vector @@ tsq)
    )
  ORDER BY
    match_rank,
    CASE WHEN near AND q = '' THEN public.haversine_km(p_near_lat, p_near_lng, p.lat, p.lng) END ASC NULLS LAST,
    length(COALESCE(p.full_name, p.handle, '')),
    COALESCE(p.full_name, p.handle, ''),
    p.id
  LIMIT GREATEST(COALESCE(max_results, 20), 1);
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_places(q text, max_results integer DEFAULT 10, p_country_code text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, region text, region_code text, country text, country_code text, lat double precision, lng double precision, population integer, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn  text := public.search_normalize(q);
  tsq tsquery := public.search_prefix_tsquery(q);
  lim int := GREATEST(COALESCE(max_results, 10), 1);
BEGIN
  IF tsq IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.region, p.region_code, p.country, p.country_code, p.lat, p.lng, p.population,
    CASE WHEN public.search_normalize(p.name) = qn THEN 0
         WHEN public.search_normalize(p.name) LIKE qn || '%' THEN 1
         WHEN EXISTS (SELECT 1 FROM place_aliases a WHERE a.geonames_id = p.geonames_id AND a.alias_norm LIKE qn || '%') THEN 2
         ELSE 3 END AS match_rank
  FROM places p
  WHERE (p.search_vector @@ tsq
         OR EXISTS (SELECT 1 FROM place_aliases a WHERE a.geonames_id = p.geonames_id AND a.alias_norm LIKE qn || '%'))
    AND (p_country_code IS NULL OR p.country_code = upper(p_country_code))
  ORDER BY 10, p.population DESC NULLS LAST, p.name
  LIMIT lim;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_posts(search_query text, max_results integer DEFAULT 15)
 RETURNS TABLE(id uuid, caption text, sport_key text, created_at timestamp with time zone, profile_id uuid, rank real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY SELECT
    po.id, po.caption, po.sport_key, po.created_at, po.profile_id,
    ts_rank(po.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.posts po
  WHERE po.visibility = 'public'
  AND po.status = 'published'
  AND po.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, po.created_at DESC
  LIMIT max_results;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_prefix_tsquery(q text)
 RETURNS tsquery
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN cardinality(toks) = 0 THEN NULL
    ELSE to_tsquery('simple', array_to_string(ARRAY(SELECT t || ':*' FROM unnest(toks) AS t), ' & '))
  END
  FROM (
    SELECT array_remove(regexp_split_to_array(public.search_normalize(q), '[^[:alnum:]]+'), '') AS toks
  ) s
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_profiles(search_query text, max_results integer DEFAULT 20)
 RETURNS TABLE(id uuid, full_name text, first_name text, middle_name text, last_name text, avatar_url text, location text, sport text, school text, visibility text, rank real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY SELECT
    p.id,
    p.full_name,
    p.first_name,
    p.middle_name,
    p.last_name,
    p.avatar_url,
    p.location,
    p.sport,
    p.school,
    p.visibility,
    ts_rank(p.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.profiles p
  WHERE p.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, p.full_name ASC NULLS LAST
  LIMIT max_results;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_query_tokens(q text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT array_remove(regexp_split_to_array(public.search_normalize(q), '[^[:alnum:]]+'), '')
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_token_hits(vec tsvector, q text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT count(*)::int
  FROM unnest(public.search_query_tokens(q)) AS t
  WHERE vec @@ to_tsquery('simple', t || ':*')
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.search_token_rank(vec tsvector, q text)
 RETURNS real
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT COALESCE(sum(ts_rank(vec, to_tsquery('simple', t || ':*'))), 0)::real
  FROM unnest(public.search_query_tokens(q)) AS t
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.split_full_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Only process if full_name changed and is not null
  IF NEW.full_name IS NOT NULL AND NEW.full_name != '' THEN
    -- If first_name is empty, extract it from full_name
    IF NEW.first_name IS NULL OR NEW.first_name = '' THEN
      NEW.first_name := SPLIT_PART(TRIM(NEW.full_name), ' ', 1);
    END IF;

    -- If last_name is empty, extract it from full_name
    IF NEW.last_name IS NULL OR NEW.last_name = '' THEN
      -- Check if there are multiple words in full_name
      IF ARRAY_LENGTH(STRING_TO_ARRAY(TRIM(NEW.full_name), ' '), 1) > 1 THEN
        NEW.last_name := TRIM(SUBSTRING(
          TRIM(NEW.full_name)
          FROM POSITION(' ' IN TRIM(NEW.full_name)) + 1
        ));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.sync_privacy_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- When visibility changes, update or create privacy_settings
  INSERT INTO public.privacy_settings (profile_id, profile_visibility)
  VALUES (NEW.id, NEW.visibility)
  ON CONFLICT (profile_id)
  DO UPDATE SET
    profile_visibility = NEW.visibility,
    updated_at = NOW();

  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_connection_suggestions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE conversations SET updated_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_equipment_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_follows_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_group_post_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_post_comments_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_post_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post_id := OLD.post_id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE public.posts
  SET comments_count = (
    SELECT COUNT(*) FROM public.post_comments
    WHERE post_id = target_post_id AND status = 'published'
  )
  WHERE id = target_post_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_post_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_post_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post_id := OLD.post_id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE public.posts
  SET likes_count = (
    SELECT COUNT(*) FROM public.post_likes WHERE post_id = target_post_id
  )
  WHERE id = target_post_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_post_reposts_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  old_target UUID;
  new_target UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_target := NEW.shared_post_id;
  ELSIF TG_OP = 'DELETE' THEN
    old_target := OLD.shared_post_id;
  ELSE -- UPDATE OF shared_post_id
    IF OLD.shared_post_id IS DISTINCT FROM NEW.shared_post_id THEN
      old_target := OLD.shared_post_id;
      new_target := NEW.shared_post_id;
    END IF;
  END IF;

  IF old_target IS NOT NULL THEN
    UPDATE public.posts
    SET reposts_count = (
      SELECT COUNT(*) FROM public.posts WHERE shared_post_id = old_target
    )
    WHERE id = old_target;
  END IF;

  IF new_target IS NOT NULL THEN
    UPDATE public.posts
    SET reposts_count = (
      SELECT COUNT(*) FROM public.posts WHERE shared_post_id = new_target
    )
    WHERE id = new_target;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_post_tags_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Unconditional stamp, as migration 008 intended. Do NOT reintroduce a
  -- column guard here: this function is attached to post_tags, and guarding on
  -- a column that table does not have is the entire bug being fixed.
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;
DO $pass1$ BEGIN
CREATE OR REPLACE FUNCTION public.update_user_handle(p_profile_id uuid, p_new_handle text)
 RETURNS TABLE(success boolean, message text, new_handle text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  current_handle TEXT;
  profile_exists BOOLEAN;
  clean_new_handle TEXT;
  last_change TIMESTAMP WITH TIME ZONE;
  change_count INT;
  availability_result RECORD;
  jwt_role TEXT;
BEGIN
  SELECT TRUE, handle, handle_updated_at, handle_change_count
  INTO profile_exists, current_handle, last_change, change_count
  FROM public.profiles
  WHERE id = p_profile_id;

  IF profile_exists IS NOT TRUE THEN
    RETURN QUERY SELECT FALSE, 'Profile not found', NULL::TEXT;
    RETURN;
  END IF;

  clean_new_handle := LOWER(TRIM(p_new_handle));

  IF current_handle IS NULL THEN
    jwt_role := COALESCE(
      current_setting('request.jwt.claims', true)::jsonb->>'role', '');
    IF NOT (jwt_role = 'service_role'
            OR p_profile_id = auth.uid()
            OR public.has_profile_access(p_profile_id, ARRAY['owner','guardian'])) THEN
      RETURN QUERY SELECT FALSE, 'Not permitted to set this handle', NULL::TEXT;
      RETURN;
    END IF;
    SELECT * INTO availability_result
    FROM public.check_handle_availability(clean_new_handle, p_profile_id);
    IF NOT availability_result.available THEN
      RETURN QUERY SELECT FALSE, availability_result.reason, NULL::TEXT;
      RETURN;
    END IF;
    UPDATE public.profiles
    SET handle = p_new_handle, handle_updated_at = NOW(),
        handle_change_count = COALESCE(change_count, 0)
    WHERE id = p_profile_id;
    RETURN QUERY SELECT TRUE, 'Handle set successfully!', p_new_handle;
    RETURN;
  END IF;

  IF LOWER(current_handle) = clean_new_handle THEN
    UPDATE public.profiles SET handle = p_new_handle WHERE id = p_profile_id;
    RETURN QUERY SELECT TRUE, 'Handle casing updated', p_new_handle;
    RETURN;
  END IF;

  IF last_change IS NOT NULL AND last_change > NOW() - INTERVAL '7 days' THEN
    RETURN QUERY SELECT
      FALSE,
      'You can only change your handle once per week. Next available: ' ||
        TO_CHAR(last_change + INTERVAL '7 days', 'Mon DD, YYYY'),
      NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO availability_result
  FROM public.check_handle_availability(clean_new_handle, p_profile_id);
  IF NOT availability_result.available THEN
    RETURN QUERY SELECT FALSE, availability_result.reason, NULL::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.handle_history (profile_id, old_handle, new_handle)
  VALUES (p_profile_id, current_handle, clean_new_handle);

  UPDATE public.profiles
  SET handle = p_new_handle,
      handle_updated_at = NOW(),
      handle_change_count = COALESCE(change_count, 0) + 1
  WHERE id = p_profile_id;

  RETURN QUERY SELECT
    TRUE,
    'Handle updated successfully! Old @mentions will redirect for 30 days.',
    p_new_handle;
END;
$function$;
EXCEPTION WHEN OTHERS THEN NULL; -- created by pass 2
END $pass1$;

-- ── Tables (118) ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.affiliations (
  org_id uuid NOT NULL,
  parent_org_id uuid NOT NULL,
  affiliation_type text DEFAULT 'partner_of'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  initiated_by text NOT NULL,
  requested_by_profile_id uuid,
  decided_by_profile_id uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  decided_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.approved_contacts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  child_profile_id uuid NOT NULL,
  contact_profile_id uuid NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  decided_by uuid,
  decided_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.athlete_achievements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  sport_key text,
  achieved_on date NOT NULL,
  organization text,
  placement text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.athlete_claim_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  profile_id uuid NOT NULL,
  team_id uuid,
  invited_email text,
  created_by uuid,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  consumed_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  org_id uuid
);

CREATE TABLE IF NOT EXISTS public.athlete_equipment (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  profile_id uuid NOT NULL,
  sport_key text,
  category text NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  image_url text,
  specs jsonb,
  status text DEFAULT 'active'::text,
  acquired_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  added_at timestamp with time zone DEFAULT now(),
  retired_at timestamp with time zone,
  acquired_on date DEFAULT CURRENT_DATE,
  retired_on date,
  group_label text
);

CREATE TABLE IF NOT EXISTS public.athlete_performances (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  sport_key text NOT NULL,
  occurred_on date NOT NULL,
  source text NOT NULL,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  natural_key text NOT NULL,
  contest_id uuid,
  provenance text DEFAULT 'self_reported'::text NOT NULL,
  dispute_status text DEFAULT 'none'::text NOT NULL,
  entered_by uuid,
  metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
  context jsonb,
  headline numeric,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.athlete_vitals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  metric_key text NOT NULL,
  metric_category text NOT NULL,
  metric_label text NOT NULL,
  value numeric,
  value_display text,
  unit text NOT NULL,
  notes text,
  source text DEFAULT 'manual'::text NOT NULL,
  recorded_at date DEFAULT CURRENT_DATE NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  linked_post_id uuid
);

CREATE TABLE IF NOT EXISTS public.calendar_feed_tokens (
  profile_id uuid NOT NULL,
  token_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  rotated_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.comment_likes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  comment_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.competition_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  competition_id uuid NOT NULL,
  team_id uuid,
  profile_id uuid,
  status text DEFAULT 'approved'::text NOT NULL,
  seed integer,
  pool text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  name text,
  source_ref text,
  affiliation_team_id uuid
);

CREATE TABLE IF NOT EXISTS public.competition_entry_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entry_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  position smallint DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.competition_standings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  competition_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  rank integer NOT NULL,
  points numeric,
  played integer DEFAULT 0 NOT NULL,
  stats jsonb DEFAULT '{}'::jsonb NOT NULL,
  computed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.competitions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  season_id uuid NOT NULL,
  division_id uuid,
  sport_key text NOT NULL,
  name text NOT NULL,
  format text NOT NULL,
  entrant_type text NOT NULL,
  scoring_rule text,
  status text DEFAULT 'draft'::text NOT NULL,
  visibility text DEFAULT 'private'::text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.connection_suggestions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  suggested_profile_id uuid NOT NULL,
  score numeric(3,2) DEFAULT 0.5,
  reason text,
  dismissed boolean DEFAULT false,
  dismissed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.consent_records (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid,
  pending_profile_id uuid,
  subject_dob_year smallint NOT NULL,
  guardian_user_id uuid,
  guardian_email_snapshot text NOT NULL,
  method text NOT NULL,
  action text NOT NULL,
  policy_version text NOT NULL,
  jurisdiction text NOT NULL,
  threshold_age smallint NOT NULL,
  evidence_path text,
  reviewed_by uuid,
  ip inet,
  user_agent text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  message text NOT NULL,
  delivered boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.contest_media (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contest_id uuid NOT NULL,
  storage_path text NOT NULL,
  media_type text DEFAULT 'image'::text NOT NULL,
  caption text,
  published boolean DEFAULT false NOT NULL,
  uploaded_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.contest_media_tags (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  media_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  tagged_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.contest_participants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contest_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  side text,
  start_position integer,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.contest_results (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contest_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  score numeric,
  provenance text DEFAULT 'club_recorded'::text NOT NULL,
  dispute_status text DEFAULT 'none'::text NOT NULL,
  entered_by uuid,
  confirmed_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  disputed_by uuid,
  disputed_at timestamp with time zone,
  dispute_note text,
  resolved_by uuid,
  resolved_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.contest_stat_lines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contest_id uuid NOT NULL,
  team_id uuid,
  profile_id uuid NOT NULL,
  stats jsonb DEFAULT '{}'::jsonb NOT NULL,
  provenance text NOT NULL,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.contests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  competition_id uuid NOT NULL,
  event_id uuid,
  venue_id uuid,
  facility_id uuid,
  scheduled_at timestamp with time zone,
  round text,
  status text DEFAULT 'scheduled'::text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  holes smallint,
  play_from date,
  play_to date,
  sport_event_round_id uuid,
  stage smallint,
  slot smallint,
  sport_event_match_id uuid
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  role text DEFAULT 'member'::text NOT NULL,
  last_read_at timestamp with time zone,
  is_muted boolean DEFAULT false NOT NULL,
  joined_at timestamp with time zone DEFAULT now() NOT NULL,
  left_at timestamp with time zone,
  held_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  type text NOT NULL,
  name text,
  avatar_url text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  frozen_at timestamp with time zone,
  frozen_ticket_id uuid
);

CREATE TABLE IF NOT EXISTS public.divisions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  season_id uuid NOT NULL,
  sport_key text NOT NULL,
  name text NOT NULL,
  age_band text,
  gender_stream text,
  tier text,
  capacity_estimate integer,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.event_carpool_claims (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  offer_id uuid NOT NULL,
  rider_profile_id uuid NOT NULL,
  seats smallint DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.event_carpool_offers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_id uuid NOT NULL,
  driver_profile_id uuid NOT NULL,
  seats_total smallint NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.event_guests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_id uuid NOT NULL,
  profile_id uuid,
  invited_email text,
  role text DEFAULT 'guest'::text NOT NULL,
  status text DEFAULT 'invited'::text NOT NULL,
  responded_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reminder_minutes smallint DEFAULT 30 NOT NULL,
  reminded_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.event_series (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organizer_id uuid NOT NULL,
  freq text NOT NULL,
  interval_n smallint DEFAULT 1 NOT NULL,
  byweekday smallint[],
  ends text DEFAULT 'never'::text NOT NULL,
  until_at timestamp with time zone,
  count_n smallint,
  generated_until timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organizer_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  location text,
  starts_at timestamp with time zone NOT NULL,
  ends_at timestamp with time zone NOT NULL,
  all_day boolean DEFAULT false NOT NULL,
  timezone text NOT NULL,
  category text DEFAULT 'general'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  series_id uuid,
  series_override boolean DEFAULT false NOT NULL,
  routine_id uuid,
  routine_snapshot jsonb,
  venue_id uuid,
  facility_id uuid,
  division_id uuid,
  team_id uuid,
  org_id uuid
);

CREATE TABLE IF NOT EXISTS public.facilities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  venue_id uuid NOT NULL,
  name text NOT NULL,
  kind text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.follows (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  follower_id uuid NOT NULL,
  following_id uuid NOT NULL,
  status text DEFAULT 'accepted'::text,
  message text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.golf_clubs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  city text,
  region text,
  region_code text,
  country text,
  country_code text,
  place_id uuid,
  lat double precision,
  lng double precision,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.golf_courses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  external_source text NOT NULL,
  external_id text NOT NULL,
  name text NOT NULL,
  club_name text,
  city text,
  region text,
  country text,
  total_par integer,
  holes_count integer,
  hole_data jsonb,
  course_rating jsonb DEFAULT '{}'::jsonb NOT NULL,
  slope_rating jsonb DEFAULT '{}'::jsonb NOT NULL,
  lat double precision,
  lng double precision,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  description text,
  description_attribution text,
  architect text,
  year_built integer,
  course_type text,
  website text,
  phone text,
  hydrated_at timestamp with time zone,
  hole_geometry jsonb,
  hole_geometry_at timestamp with time zone,
  place_id uuid,
  country_code text,
  region_code text,
  location_source text,
  search_vector tsvector,
  club_id uuid,
  section_name text,
  section_kind text
);

CREATE TABLE IF NOT EXISTS public.golf_hole_scores (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  golf_participant_id uuid NOT NULL,
  hole_number integer NOT NULL,
  strokes integer NOT NULL,
  putts integer,
  fairway_hit boolean,
  green_in_regulation boolean,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  penalties text[],
  version integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.golf_holes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  round_id uuid NOT NULL,
  hole_number integer NOT NULL,
  par integer,
  strokes integer,
  putts integer,
  fairway_hit boolean,
  green_in_regulation boolean,
  distance_yards integer,
  club_off_tee text,
  notes text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  penalties text[]
);

CREATE TABLE IF NOT EXISTS public.golf_participant_scores (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  participant_id uuid NOT NULL,
  entered_by uuid,
  scores_confirmed boolean DEFAULT false,
  total_score integer,
  to_par integer,
  holes_completed integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'in_progress'::text NOT NULL,
  submitted_at timestamp with time zone,
  finalized_by uuid
);

CREATE TABLE IF NOT EXISTS public.golf_rounds (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  date date NOT NULL,
  course text NOT NULL,
  course_location text,
  tee text,
  holes integer DEFAULT 18 NOT NULL,
  par integer DEFAULT 72,
  gross_score integer,
  fir_percentage numeric(5,2),
  gir_percentage numeric(5,2),
  total_putts integer,
  notes text,
  is_complete boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  weather text,
  temperature integer,
  wind text,
  course_rating numeric(4,1),
  slope_rating integer,
  round_type text DEFAULT 'outdoor'::text,
  group_post_id uuid,
  course_id uuid
);

CREATE TABLE IF NOT EXISTS public.golf_scorecard_data (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  group_post_id uuid NOT NULL,
  course_name text NOT NULL,
  course_id uuid,
  round_type text NOT NULL,
  holes_played integer NOT NULL,
  tee_color text,
  slope_rating integer,
  course_rating numeric(4,1),
  weather_conditions text,
  temperature integer,
  wind_speed integer,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  game_format text DEFAULT 'stroke'::text NOT NULL,
  hole_data jsonb,
  course_composition jsonb
);

CREATE TABLE IF NOT EXISTS public.group_post_media (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  group_post_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  media_url text NOT NULL,
  media_type text NOT NULL,
  caption text,
  position integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  thumbnail_url text,
  segment_number integer,
  segment_kind text,
  duration_seconds integer,
  is_highlight boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public.group_post_participants (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  group_post_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  status text DEFAULT 'pending'::text,
  attested_at timestamp with time zone,
  role text DEFAULT 'participant'::text,
  data_contributed boolean DEFAULT false,
  last_contribution timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  position integer
);

CREATE TABLE IF NOT EXISTS public.group_posts (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  creator_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  description text,
  date date NOT NULL,
  location text,
  visibility text DEFAULT 'public'::text,
  status text DEFAULT 'pending'::text,
  post_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  contest_id uuid,
  sport_event_round_id uuid
);

CREATE TABLE IF NOT EXISTS public.guardian_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  invite_type text NOT NULL,
  invited_email text NOT NULL,
  pending_profile_id uuid,
  profile_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
  consumed_at timestamp with time zone,
  grant_role text DEFAULT 'guardian'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.handle_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  old_handle text NOT NULL,
  new_handle text NOT NULL,
  changed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.help_articles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  topic text NOT NULL,
  video_url text,
  sort_order integer DEFAULT 100 NOT NULL,
  published boolean DEFAULT false NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.memberships (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  kind text DEFAULT 'follow'::text NOT NULL,
  role text DEFAULT 'member'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  scope_type text DEFAULT 'org'::text NOT NULL,
  scope_id uuid,
  season_id uuid,
  joined_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  photo_consent boolean,
  photo_consent_at timestamp with time zone,
  photo_consent_by uuid,
  sections text[],
  granted_by uuid,
  granted_at timestamp with time zone,
  expires_at timestamp with time zone,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  message_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.message_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  message_id uuid,
  reported_profile_id uuid NOT NULL,
  reporter_id uuid NOT NULL,
  conversation_id uuid,
  reason text NOT NULL,
  details text,
  status text DEFAULT 'open'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  type text DEFAULT 'text'::text NOT NULL,
  content text,
  media_url text,
  media_type text,
  shared_post_id uuid,
  shared_profile_id uuid,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  parent_message_id uuid,
  edited_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  follow_requests_enabled boolean DEFAULT true,
  follow_accepted_enabled boolean DEFAULT true,
  new_followers_enabled boolean DEFAULT true,
  likes_enabled boolean DEFAULT true,
  comments_enabled boolean DEFAULT true,
  mentions_enabled boolean DEFAULT true,
  tags_enabled boolean DEFAULT true,
  achievements_enabled boolean DEFAULT true,
  system_announcements_enabled boolean DEFAULT true,
  club_updates_enabled boolean DEFAULT true,
  push_enabled boolean DEFAULT true,
  email_enabled boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  last_digest_at timestamp with time zone,
  urgent_email_enabled boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  actor_id uuid,
  post_id uuid,
  comment_id uuid,
  follow_id uuid,
  title text NOT NULL,
  message text,
  action_url text,
  metadata jsonb,
  is_read boolean DEFAULT false,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  action_status text,
  action_taken_at timestamp with time zone,
  grouped_notification_id uuid,
  emailed_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.org_claim_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  invited_email text,
  created_by uuid,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  consumed_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.org_join_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.org_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL,
  requester_profile_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  sport_key text,
  place_id uuid,
  city text,
  region text,
  region_code text,
  country text,
  country_code text,
  lat double precision,
  lng double precision,
  location_source text,
  status text DEFAULT 'pending'::text NOT NULL,
  decline_reason text,
  reviewed_by uuid,
  decided_at timestamp with time zone,
  created_org_id uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  operates_competitions boolean,
  operates_teams boolean,
  structure_draft jsonb,
  connections_draft jsonb,
  site_draft jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.org_site_form_submissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  kind text NOT NULL,
  fields jsonb DEFAULT '{}'::jsonb NOT NULL,
  page_path text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  read_at timestamp with time zone,
  archived_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.org_site_hit_marks (
  site_id uuid NOT NULL,
  day date NOT NULL,
  visitor_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.org_site_modules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  module_key text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.org_site_news (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  body jsonb DEFAULT '[]'::jsonb NOT NULL,
  published_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  audience text DEFAULT 'public'::text NOT NULL,
  pinned_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.org_site_pages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  body jsonb DEFAULT '[]'::jsonb NOT NULL,
  visibility text DEFAULT 'draft'::text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  layout jsonb,
  in_nav boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS public.org_site_revisions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  rev integer DEFAULT 1 NOT NULL,
  label text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  published_at timestamp with time zone,
  published_by uuid,
  stats jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.org_site_stats_daily (
  site_id uuid NOT NULL,
  day date NOT NULL,
  path text NOT NULL,
  views integer DEFAULT 0 NOT NULL,
  visitors integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.org_sites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  subdomain text NOT NULL,
  template_id text DEFAULT 'classic'::text NOT NULL,
  theme_token_set jsonb DEFAULT '{}'::jsonb NOT NULL,
  nav_config jsonb DEFAULT '[]'::jsonb NOT NULL,
  logo_path text,
  hero_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  contact_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  custom_domain text,
  domain_verified_at timestamp with time zone,
  published_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  domain_verification_token text,
  domain_requested_at timestamp with time zone,
  domain_vercel_state text,
  domain_vercel_at timestamp with time zone,
  domain_vercel_detail jsonb,
  domain_active_at timestamp with time zone,
  draft_revision_id uuid,
  published_revision_id uuid,
  seo_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  footer_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.org_staff_audit (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid,
  actor_id uuid,
  action text NOT NULL,
  role text,
  scope_type text,
  scope_id uuid,
  season_id uuid,
  old_sections text[],
  new_sections text[],
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  org_id uuid
);

CREATE TABLE IF NOT EXISTS public.org_staff_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  invited_email text NOT NULL,
  role text NOT NULL,
  sections text[],
  scope_type text DEFAULT 'org'::text NOT NULL,
  scope_id uuid,
  season_id uuid,
  created_by uuid,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  consumed_by uuid,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  description text,
  sport_key text,
  owner_profile_id uuid,
  place_id uuid,
  city text,
  region text,
  region_code text,
  country text,
  country_code text,
  lat double precision,
  lng double precision,
  location_source text,
  location text,
  search_vector tsvector,
  operates_competitions boolean DEFAULT false NOT NULL,
  operates_teams boolean DEFAULT false NOT NULL,
  approved_at timestamp with time zone DEFAULT now(),
  visibility text DEFAULT 'public'::text NOT NULL,
  join_policy text DEFAULT 'open'::text NOT NULL,
  listing_status text DEFAULT 'listed'::text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.pending_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  payload jsonb NOT NULL,
  child_email text,
  dob date NOT NULL,
  jurisdiction text NOT NULL,
  threshold_age smallint NOT NULL,
  auth_user_id uuid,
  state text DEFAULT 'awaiting_guardian'::text NOT NULL,
  promoted_profile_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.performances (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  date date NOT NULL,
  event text NOT NULL,
  result_place text,
  stat_primary text,
  organization text,
  athletic_score numeric,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.place_aliases (
  geonames_id integer NOT NULL,
  alias text NOT NULL,
  alias_norm text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.places (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  geonames_id integer NOT NULL,
  name text NOT NULL,
  ascii_name text,
  region text,
  region_code text,
  country text NOT NULL,
  country_code text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  population integer,
  feature_code text,
  search_vector tsvector,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  admin2 text,
  admin2_code text,
  metro text,
  metro_geonames_id integer
);

CREATE TABLE IF NOT EXISTS public.platform_admins (
  profile_id uuid NOT NULL,
  role text NOT NULL,
  granted_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  post_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  parent_comment_id uuid,
  content text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  likes_count integer DEFAULT 0,
  gif_url text,
  is_pinned boolean DEFAULT false,
  mentions uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  created_by_user_id uuid,
  status text DEFAULT 'published'::text NOT NULL,
  review_note text,
  approval_nudged_at timestamp with time zone,
  hidden_at timestamp with time zone,
  hidden_ticket_id uuid
);

CREATE TABLE IF NOT EXISTS public.post_likes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  post_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.post_media (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  post_id uuid NOT NULL,
  media_url text NOT NULL,
  media_type text NOT NULL,
  thumbnail_url text,
  display_order integer DEFAULT 0,
  width integer,
  height integer,
  duration integer,
  created_at timestamp with time zone DEFAULT now(),
  source_url text,
  edit_recipe jsonb
);

CREATE TABLE IF NOT EXISTS public.post_tags (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  post_id uuid NOT NULL,
  media_id uuid,
  tagged_profile_id uuid NOT NULL,
  created_by_profile_id uuid NOT NULL,
  position_x numeric(5,2),
  position_y numeric(5,2),
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  sport_key text,
  caption text,
  visibility text DEFAULT 'public'::text,
  stats_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  likes_count integer DEFAULT 0,
  comments_count integer DEFAULT 0,
  shares_count integer DEFAULT 0,
  tags text[] DEFAULT '{}'::text[],
  hashtags text[] DEFAULT '{}'::text[],
  round_id uuid,
  search_vector tsvector,
  saves_count integer DEFAULT 0 NOT NULL,
  group_post_id uuid,
  activity_mode text,
  is_pinned boolean DEFAULT false NOT NULL,
  pinned_at timestamp with time zone,
  status text DEFAULT 'published'::text NOT NULL,
  shared_post_id uuid,
  reposts_count integer DEFAULT 0 NOT NULL,
  post_category text,
  created_by_user_id uuid,
  review_note text,
  approval_nudged_at timestamp with time zone,
  event_id uuid,
  contest_id uuid,
  sport_event_round_id uuid,
  hidden_at timestamp with time zone,
  hidden_ticket_id uuid
);

CREATE TABLE IF NOT EXISTS public.privacy_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid,
  profile_visibility text DEFAULT 'public'::text,
  media_visibility text DEFAULT 'inherit'::text,
  stats_visibility text DEFAULT 'inherit'::text,
  posts_visibility text DEFAULT 'inherit'::text,
  activity_visibility text DEFAULT 'inherit'::text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profile_access (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  role text NOT NULL,
  granted_at timestamp with time zone DEFAULT now() NOT NULL,
  granted_by uuid
);

CREATE TABLE IF NOT EXISTS public.profile_access_audit (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL,
  old_role text,
  new_role text,
  actor_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profile_transfers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  state text DEFAULT 'initiated'::text NOT NULL,
  initiated_by text NOT NULL,
  initiator_user_id uuid,
  athlete_contact_email text,
  contact_verified_at timestamp with time zone,
  athlete_confirmed_at timestamp with time zone,
  guardian_confirmed_at timestamp with time zone,
  guardian_confirmed_by uuid,
  cooling_off_ends_at timestamp with time zone,
  executed_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
  guardian_post_role text,
  dob_snapshot date NOT NULL,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  cancelled_by uuid,
  cancel_reason text,
  failure_reason text,
  failure_count smallint DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  age_preset_prompt text,
  handover_prompted_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  email text NOT NULL,
  first_name text,
  last_name text,
  nickname text,
  phone text,
  birthday date,
  gender text,
  location text,
  postal_code text,
  user_type text DEFAULT 'athlete'::text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  username text,
  full_name text,
  bio text,
  height_cm integer,
  weight_kg numeric(5,2),
  dob date,
  class_year integer,
  social_twitter text,
  social_instagram text,
  social_facebook text,
  avatar_url text,
  weight_unit text DEFAULT 'lbs'::text,
  weight_display numeric(5,2),
  display_name text,
  sport text,
  school text,
  coach text,
  graduation_year integer,
  gpa numeric(3,2),
  sat_score integer,
  act_score integer,
  visibility text DEFAULT 'public'::text,
  middle_name text,
  search_vector tsvector,
  handle text,
  handle_updated_at timestamp with time zone,
  handle_change_count integer DEFAULT 0,
  messaging_permission text DEFAULT 'everyone'::text NOT NULL,
  onboarded_at timestamp with time zone,
  cover_url text,
  supervision_state text DEFAULT 'self'::text NOT NULL,
  jurisdiction text,
  minor_threshold_age smallint,
  dob_locked boolean DEFAULT false NOT NULL,
  equipment_prefs jsonb,
  social_tiktok text,
  theme_prefs jsonb,
  comment_moderation text DEFAULT 'held'::text NOT NULL,
  place_id uuid,
  city text,
  region text,
  region_code text,
  country text,
  country_code text,
  lat double precision,
  lng double precision,
  location_source text,
  vitals_privacy jsonb,
  deletion_requested_at timestamp with time zone,
  household_policy jsonb,
  recruiting_status text DEFAULT 'closed'::text,
  recruiting_profile jsonb,
  scout_affiliation text,
  moderation_state text DEFAULT 'active'::text,
  moderation_until timestamp with time zone,
  moderation_ticket_id uuid,
  followers_count integer DEFAULT 0,
  following_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.programs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  season_id uuid NOT NULL,
  sport_key text NOT NULL,
  type text DEFAULT 'other'::text NOT NULL,
  name text NOT NULL,
  capacity_estimate integer,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  count integer NOT NULL
);

CREATE TABLE IF NOT EXISTS public.registration_windows (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  season_id uuid NOT NULL,
  division_id uuid,
  program_id uuid,
  opens_at timestamp with time zone NOT NULL,
  closes_at timestamp with time zone,
  capacity integer,
  created_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.registrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  season_id uuid NOT NULL,
  division_id uuid,
  program_id uuid,
  submitted_by uuid,
  answers jsonb DEFAULT '{}'::jsonb NOT NULL,
  eligibility jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  withdrawn_at timestamp with time zone,
  released_at timestamp with time zone,
  released_by uuid,
  released_reason text,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.reserved_handles (
  handle text NOT NULL,
  reason text NOT NULL,
  reserved_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.risk_signals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  kind text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  window_end timestamp with time zone NOT NULL,
  magnitude jsonb DEFAULT '{}'::jsonb NOT NULL,
  acknowledged_at timestamp with time zone,
  acknowledged_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.safety_settings_audit (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  actor_id uuid,
  field text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sanction_grants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  granted_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  revoked_at timestamp with time zone,
  grantor_org_id uuid NOT NULL,
  grantee_org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.saved_posts (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  profile_id uuid NOT NULL,
  post_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  number integer NOT NULL,
  name text NOT NULL,
  applied_at timestamp with time zone DEFAULT now() NOT NULL,
  applied_by text DEFAULT 'sql-editor'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.scout_shortlists (
  scout_id uuid NOT NULL,
  athlete_id uuid NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.search_documents (
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  title text NOT NULL,
  subtitle text,
  sport_key text,
  owner_id uuid,
  visibility text DEFAULT 'public'::text NOT NULL,
  place_id uuid,
  city text,
  region text,
  region_code text,
  country text,
  country_code text,
  lat double precision,
  lng double precision,
  rich boolean DEFAULT false NOT NULL,
  recency timestamp with time zone,
  search_vector tsvector NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.season_highlights (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  sport_key text NOT NULL,
  season text NOT NULL,
  metric_a text,
  metric_b text,
  metric_c text,
  rating numeric,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.seasons (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  label text NOT NULL,
  starts_on date,
  ends_on date,
  sport_key text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  archived_at timestamp with time zone,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sport_event_group_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  group_id uuid NOT NULL,
  sport_event_round_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  position smallint NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  side smallint
);

CREATE TABLE IF NOT EXISTS public.sport_event_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sport_event_round_id uuid NOT NULL,
  sequence smallint NOT NULL,
  name text,
  tee_time timestamp with time zone,
  starting_hole smallint DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sport_event_matches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sport_event_round_id uuid NOT NULL,
  group_id uuid NOT NULL,
  concessions jsonb DEFAULT '[]'::jsonb NOT NULL,
  extra_holes jsonb DEFAULT '[]'::jsonb NOT NULL,
  decided_by text,
  winner_side smallint,
  result text,
  decided_at timestamp with time zone,
  version integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sport_event_media (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sport_event_id uuid NOT NULL,
  sport_event_round_id uuid,
  uploaded_by uuid NOT NULL,
  created_by_user_id uuid,
  media_url text NOT NULL,
  media_type text NOT NULL,
  thumbnail_url text,
  duration_seconds numeric(8,2),
  caption text,
  mirrored_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sport_event_participants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sport_event_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  role text DEFAULT 'participant'::text NOT NULL,
  status text DEFAULT 'invited'::text NOT NULL,
  playing boolean DEFAULT true NOT NULL,
  handicap_index numeric(3,1),
  handicap_source text DEFAULT 'none'::text NOT NULL,
  flight text,
  waitlist_position integer,
  hide_from_profile boolean DEFAULT false NOT NULL,
  invited_by uuid,
  accepted_at timestamp with time zone,
  responded_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  recorder boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sport_event_rounds (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sport_event_id uuid NOT NULL,
  sequence smallint NOT NULL,
  scheduled_on date NOT NULL,
  course_id uuid,
  course_name text NOT NULL,
  tee text,
  holes smallint DEFAULT 18 NOT NULL,
  starting_hole smallint DEFAULT 1 NOT NULL,
  course_rating numeric(4,1),
  slope_rating integer,
  hole_data jsonb,
  status text DEFAULT 'scheduled'::text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  name text,
  starts_at timestamp with time zone,
  side1_score integer,
  side2_score integer,
  period smallint,
  score_version integer DEFAULT 0 NOT NULL,
  timezone text
);

CREATE TABLE IF NOT EXISTS public.sport_event_stat_lines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sport_event_round_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  stats jsonb DEFAULT '{}'::jsonb NOT NULL,
  version integer DEFAULT 0 NOT NULL,
  entered_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sport_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  host_profile_id uuid NOT NULL,
  created_by_user_id uuid,
  sport_key text DEFAULT 'golf'::text NOT NULL,
  name text NOT NULL,
  description text,
  cover_path text,
  join_mode text DEFAULT 'invite'::text NOT NULL,
  visibility text DEFAULT 'public'::text NOT NULL,
  link_token text,
  format text DEFAULT 'stroke_gross'::text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  capacity integer,
  starts_on date,
  opened_at timestamp with time zone,
  went_live_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  format_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  self_entry boolean DEFAULT true NOT NULL,
  shape text DEFAULT 'round'::text NOT NULL,
  competition_id uuid,
  org_id uuid
);

CREATE TABLE IF NOT EXISTS public.sport_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  sport_key text NOT NULL,
  settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  sport_key text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.team_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  team_id uuid NOT NULL,
  division_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.teams (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  display_name text,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  org_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ticket_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ticket_id uuid NOT NULL,
  actor_profile_id uuid,
  kind text NOT NULL,
  old_value text,
  new_value text,
  body text,
  visible_to_user boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  number bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) NOT NULL,
  type text NOT NULL,
  subtype text,
  reason text NOT NULL,
  severity text NOT NULL,
  status text DEFAULT 'new'::text NOT NULL,
  subject text,
  description text,
  reporter_profile_id uuid,
  reporter_email text,
  guest_email text,
  target_type text,
  target_id uuid,
  target_profile_id uuid,
  content_snapshot jsonb,
  attachment_url text,
  report_count integer DEFAULT 1 NOT NULL,
  merged_into_id uuid,
  assignee_profile_id uuid,
  resolution_code text,
  resolution_note text,
  suggestion_tag text,
  contact_ok boolean DEFAULT true NOT NULL,
  appeal_used_at timestamp with time zone,
  first_response_at timestamp with time zone,
  resolved_at timestamp with time zone,
  closed_at timestamp with time zone,
  anonymized_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_blocks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_media_presets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  name text NOT NULL,
  look jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_mutes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  muter_id uuid NOT NULL,
  muted_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.venues (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  golf_club_id uuid,
  place_id uuid,
  city text,
  region text,
  region_code text,
  country text,
  country_code text,
  lat double precision,
  lng double precision,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  golf_course_id uuid,
  org_id uuid
);

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  user_type text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.workout_exercises (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  name text NOT NULL,
  exercise_key text,
  category text DEFAULT 'strength'::text NOT NULL,
  position integer DEFAULT 0 NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.workout_routine_exercises (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  routine_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  name text NOT NULL,
  exercise_key text,
  category text DEFAULT 'strength'::text NOT NULL,
  position integer DEFAULT 0 NOT NULL,
  notes text,
  target_sets integer DEFAULT 3 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.workout_routines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.workout_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  title text,
  notes text,
  status text DEFAULT 'active'::text NOT NULL,
  source text DEFAULT 'live'::text NOT NULL,
  started_at timestamp with time zone NOT NULL,
  ended_at timestamp with time zone,
  duration_seconds integer,
  post_id uuid,
  last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.workout_sets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  exercise_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  set_number integer NOT NULL,
  reps integer,
  weight numeric,
  weight_unit text,
  duration_seconds integer,
  distance numeric,
  distance_unit text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  media jsonb DEFAULT '[]'::jsonb NOT NULL
);

-- ── Sequence owners ───────────────────────────────────────────────────────────


-- ── Identity starts (for a table that already existed) ────────────────────────
ALTER TABLE public.tickets ALTER COLUMN number SET START WITH 1000;

-- ── Primary keys, unique, check, exclusion ────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_pkey' AND conrelid = 'public.affiliations'::regclass) THEN
    ALTER TABLE public.affiliations ADD CONSTRAINT affiliations_pkey PRIMARY KEY (org_id, parent_org_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_contacts_pkey' AND conrelid = 'public.approved_contacts'::regclass) THEN
    ALTER TABLE public.approved_contacts ADD CONSTRAINT approved_contacts_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_achievements_pkey' AND conrelid = 'public.athlete_achievements'::regclass) THEN
    ALTER TABLE public.athlete_achievements ADD CONSTRAINT athlete_achievements_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_claim_invites_pkey' AND conrelid = 'public.athlete_claim_invites'::regclass) THEN
    ALTER TABLE public.athlete_claim_invites ADD CONSTRAINT athlete_claim_invites_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_equipment_pkey' AND conrelid = 'public.athlete_equipment'::regclass) THEN
    ALTER TABLE public.athlete_equipment ADD CONSTRAINT athlete_equipment_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_performances_pkey' AND conrelid = 'public.athlete_performances'::regclass) THEN
    ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_vitals_pkey' AND conrelid = 'public.athlete_vitals'::regclass) THEN
    ALTER TABLE public.athlete_vitals ADD CONSTRAINT athlete_vitals_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_feed_tokens_pkey' AND conrelid = 'public.calendar_feed_tokens'::regclass) THEN
    ALTER TABLE public.calendar_feed_tokens ADD CONSTRAINT calendar_feed_tokens_pkey PRIMARY KEY (profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_pkey' AND conrelid = 'public.comment_likes'::regclass) THEN
    ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_pkey' AND conrelid = 'public.competition_entries'::regclass) THEN
    ALTER TABLE public.competition_entries ADD CONSTRAINT competition_entries_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entry_members_pkey' AND conrelid = 'public.competition_entry_members'::regclass) THEN
    ALTER TABLE public.competition_entry_members ADD CONSTRAINT competition_entry_members_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_standings_pkey' AND conrelid = 'public.competition_standings'::regclass) THEN
    ALTER TABLE public.competition_standings ADD CONSTRAINT competition_standings_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_pkey' AND conrelid = 'public.competitions'::regclass) THEN
    ALTER TABLE public.competitions ADD CONSTRAINT competitions_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connection_suggestions_pkey' AND conrelid = 'public.connection_suggestions'::regclass) THEN
    ALTER TABLE public.connection_suggestions ADD CONSTRAINT connection_suggestions_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_pkey' AND conrelid = 'public.consent_records'::regclass) THEN
    ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_messages_pkey' AND conrelid = 'public.contact_messages'::regclass) THEN
    ALTER TABLE public.contact_messages ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_pkey' AND conrelid = 'public.contest_media'::regclass) THEN
    ALTER TABLE public.contest_media ADD CONSTRAINT contest_media_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_tags_pkey' AND conrelid = 'public.contest_media_tags'::regclass) THEN
    ALTER TABLE public.contest_media_tags ADD CONSTRAINT contest_media_tags_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_participants_pkey' AND conrelid = 'public.contest_participants'::regclass) THEN
    ALTER TABLE public.contest_participants ADD CONSTRAINT contest_participants_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_pkey' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_stat_lines_pkey' AND conrelid = 'public.contest_stat_lines'::regclass) THEN
    ALTER TABLE public.contest_stat_lines ADD CONSTRAINT contest_stat_lines_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_pkey' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_pkey' AND conrelid = 'public.conversation_participants'::regclass) THEN
    ALTER TABLE public.conversation_participants ADD CONSTRAINT conversation_participants_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_pkey' AND conrelid = 'public.conversations'::regclass) THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'divisions_pkey' AND conrelid = 'public.divisions'::regclass) THEN
    ALTER TABLE public.divisions ADD CONSTRAINT divisions_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_claims_pkey' AND conrelid = 'public.event_carpool_claims'::regclass) THEN
    ALTER TABLE public.event_carpool_claims ADD CONSTRAINT event_carpool_claims_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_offers_pkey' AND conrelid = 'public.event_carpool_offers'::regclass) THEN
    ALTER TABLE public.event_carpool_offers ADD CONSTRAINT event_carpool_offers_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_guests_pkey' AND conrelid = 'public.event_guests'::regclass) THEN
    ALTER TABLE public.event_guests ADD CONSTRAINT event_guests_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_pkey' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_pkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facilities_pkey' AND conrelid = 'public.facilities'::regclass) THEN
    ALTER TABLE public.facilities ADD CONSTRAINT facilities_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_pkey' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_clubs_pkey' AND conrelid = 'public.golf_clubs'::regclass) THEN
    ALTER TABLE public.golf_clubs ADD CONSTRAINT golf_clubs_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_courses_pkey' AND conrelid = 'public.golf_courses'::regclass) THEN
    ALTER TABLE public.golf_courses ADD CONSTRAINT golf_courses_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_hole_scores_pkey' AND conrelid = 'public.golf_hole_scores'::regclass) THEN
    ALTER TABLE public.golf_hole_scores ADD CONSTRAINT golf_hole_scores_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_holes_pkey' AND conrelid = 'public.golf_holes'::regclass) THEN
    ALTER TABLE public.golf_holes ADD CONSTRAINT golf_holes_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_participant_scores_pkey' AND conrelid = 'public.golf_participant_scores'::regclass) THEN
    ALTER TABLE public.golf_participant_scores ADD CONSTRAINT golf_participant_scores_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_pkey' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_pkey' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_media_pkey' AND conrelid = 'public.group_post_media'::regclass) THEN
    ALTER TABLE public.group_post_media ADD CONSTRAINT group_post_media_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_participants_pkey' AND conrelid = 'public.group_post_participants'::regclass) THEN
    ALTER TABLE public.group_post_participants ADD CONSTRAINT group_post_participants_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_posts_pkey' AND conrelid = 'public.group_posts'::regclass) THEN
    ALTER TABLE public.group_posts ADD CONSTRAINT group_posts_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardian_invites_pkey' AND conrelid = 'public.guardian_invites'::regclass) THEN
    ALTER TABLE public.guardian_invites ADD CONSTRAINT guardian_invites_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handle_history_pkey' AND conrelid = 'public.handle_history'::regclass) THEN
    ALTER TABLE public.handle_history ADD CONSTRAINT handle_history_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'help_articles_pkey' AND conrelid = 'public.help_articles'::regclass) THEN
    ALTER TABLE public.help_articles ADD CONSTRAINT help_articles_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_pkey' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_pkey' AND conrelid = 'public.message_reactions'::regclass) THEN
    ALTER TABLE public.message_reactions ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reports_pkey' AND conrelid = 'public.message_reports'::regclass) THEN
    ALTER TABLE public.message_reports ADD CONSTRAINT message_reports_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_pkey' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_pkey' AND conrelid = 'public.notification_preferences'::regclass) THEN
    ALTER TABLE public.notification_preferences ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_pkey' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_claim_invites_pkey' AND conrelid = 'public.org_claim_invites'::regclass) THEN
    ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_join_requests_pkey' AND conrelid = 'public.org_join_requests'::regclass) THEN
    ALTER TABLE public.org_join_requests ADD CONSTRAINT org_join_requests_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_requests_pkey' AND conrelid = 'public.org_requests'::regclass) THEN
    ALTER TABLE public.org_requests ADD CONSTRAINT org_requests_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_form_submissions_pkey' AND conrelid = 'public.org_site_form_submissions'::regclass) THEN
    ALTER TABLE public.org_site_form_submissions ADD CONSTRAINT org_site_form_submissions_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_hit_marks_pkey' AND conrelid = 'public.org_site_hit_marks'::regclass) THEN
    ALTER TABLE public.org_site_hit_marks ADD CONSTRAINT org_site_hit_marks_pkey PRIMARY KEY (site_id, day, visitor_hash);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_modules_pkey' AND conrelid = 'public.org_site_modules'::regclass) THEN
    ALTER TABLE public.org_site_modules ADD CONSTRAINT org_site_modules_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_news_pkey' AND conrelid = 'public.org_site_news'::regclass) THEN
    ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_pages_pkey' AND conrelid = 'public.org_site_pages'::regclass) THEN
    ALTER TABLE public.org_site_pages ADD CONSTRAINT org_site_pages_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_revisions_pkey' AND conrelid = 'public.org_site_revisions'::regclass) THEN
    ALTER TABLE public.org_site_revisions ADD CONSTRAINT org_site_revisions_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_stats_daily_pkey' AND conrelid = 'public.org_site_stats_daily'::regclass) THEN
    ALTER TABLE public.org_site_stats_daily ADD CONSTRAINT org_site_stats_daily_pkey PRIMARY KEY (site_id, day, path);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_pkey' AND conrelid = 'public.org_sites'::regclass) THEN
    ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_audit_pkey' AND conrelid = 'public.org_staff_audit'::regclass) THEN
    ALTER TABLE public.org_staff_audit ADD CONSTRAINT org_staff_audit_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_pkey' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_pkey' AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_profiles_pkey' AND conrelid = 'public.pending_profiles'::regclass) THEN
    ALTER TABLE public.pending_profiles ADD CONSTRAINT pending_profiles_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performances_pkey' AND conrelid = 'public.performances'::regclass) THEN
    ALTER TABLE public.performances ADD CONSTRAINT performances_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_aliases_pkey' AND conrelid = 'public.place_aliases'::regclass) THEN
    ALTER TABLE public.place_aliases ADD CONSTRAINT place_aliases_pkey PRIMARY KEY (geonames_id, alias_norm);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'places_pkey' AND conrelid = 'public.places'::regclass) THEN
    ALTER TABLE public.places ADD CONSTRAINT places_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_admins_pkey' AND conrelid = 'public.platform_admins'::regclass) THEN
    ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_pkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_pkey' AND conrelid = 'public.post_likes'::regclass) THEN
    ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_media_pkey' AND conrelid = 'public.post_media'::regclass) THEN
    ALTER TABLE public.post_media ADD CONSTRAINT post_media_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_tags_pkey' AND conrelid = 'public.post_tags'::regclass) THEN
    ALTER TABLE public.post_tags ADD CONSTRAINT post_tags_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_pkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_pkey' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_access_pkey' AND conrelid = 'public.profile_access'::regclass) THEN
    ALTER TABLE public.profile_access ADD CONSTRAINT profile_access_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_access_audit_pkey' AND conrelid = 'public.profile_access_audit'::regclass) THEN
    ALTER TABLE public.profile_access_audit ADD CONSTRAINT profile_access_audit_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_transfers_pkey' AND conrelid = 'public.profile_transfers'::regclass) THEN
    ALTER TABLE public.profile_transfers ADD CONSTRAINT profile_transfers_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_pkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_pkey' AND conrelid = 'public.programs'::regclass) THEN
    ALTER TABLE public.programs ADD CONSTRAINT programs_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_limits_pkey' AND conrelid = 'public.rate_limits'::regclass) THEN
    ALTER TABLE public.rate_limits ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_windows_pkey' AND conrelid = 'public.registration_windows'::regclass) THEN
    ALTER TABLE public.registration_windows ADD CONSTRAINT registration_windows_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_pkey' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reserved_handles_pkey' AND conrelid = 'public.reserved_handles'::regclass) THEN
    ALTER TABLE public.reserved_handles ADD CONSTRAINT reserved_handles_pkey PRIMARY KEY (handle);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_signals_pkey' AND conrelid = 'public.risk_signals'::regclass) THEN
    ALTER TABLE public.risk_signals ADD CONSTRAINT risk_signals_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'safety_settings_audit_pkey' AND conrelid = 'public.safety_settings_audit'::regclass) THEN
    ALTER TABLE public.safety_settings_audit ADD CONSTRAINT safety_settings_audit_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sanction_grants_pkey' AND conrelid = 'public.sanction_grants'::regclass) THEN
    ALTER TABLE public.sanction_grants ADD CONSTRAINT sanction_grants_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_posts_pkey' AND conrelid = 'public.saved_posts'::regclass) THEN
    ALTER TABLE public.saved_posts ADD CONSTRAINT saved_posts_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schema_migrations_pkey' AND conrelid = 'public.schema_migrations'::regclass) THEN
    ALTER TABLE public.schema_migrations ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (number);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scout_shortlists_pkey' AND conrelid = 'public.scout_shortlists'::regclass) THEN
    ALTER TABLE public.scout_shortlists ADD CONSTRAINT scout_shortlists_pkey PRIMARY KEY (scout_id, athlete_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'search_documents_pkey' AND conrelid = 'public.search_documents'::regclass) THEN
    ALTER TABLE public.search_documents ADD CONSTRAINT search_documents_pkey PRIMARY KEY (entity_type, entity_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_highlights_pkey' AND conrelid = 'public.season_highlights'::regclass) THEN
    ALTER TABLE public.season_highlights ADD CONSTRAINT season_highlights_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_pkey' AND conrelid = 'public.seasons'::regclass) THEN
    ALTER TABLE public.seasons ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_group_members_pkey' AND conrelid = 'public.sport_event_group_members'::regclass) THEN
    ALTER TABLE public.sport_event_group_members ADD CONSTRAINT sport_event_group_members_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_groups_pkey' AND conrelid = 'public.sport_event_groups'::regclass) THEN
    ALTER TABLE public.sport_event_groups ADD CONSTRAINT sport_event_groups_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_pkey' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_media_pkey' AND conrelid = 'public.sport_event_media'::regclass) THEN
    ALTER TABLE public.sport_event_media ADD CONSTRAINT sport_event_media_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_pkey' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_pkey' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_stat_lines_pkey' AND conrelid = 'public.sport_event_stat_lines'::regclass) THEN
    ALTER TABLE public.sport_event_stat_lines ADD CONSTRAINT sport_event_stat_lines_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_pkey' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_settings_pkey' AND conrelid = 'public.sport_settings'::regclass) THEN
    ALTER TABLE public.sport_settings ADD CONSTRAINT sport_settings_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sports_pkey' AND conrelid = 'public.sports'::regclass) THEN
    ALTER TABLE public.sports ADD CONSTRAINT sports_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_entries_pkey' AND conrelid = 'public.team_entries'::regclass) THEN
    ALTER TABLE public.team_entries ADD CONSTRAINT team_entries_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_pkey' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_events_pkey' AND conrelid = 'public.ticket_events'::regclass) THEN
    ALTER TABLE public.ticket_events ADD CONSTRAINT ticket_events_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_pkey' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_pkey' AND conrelid = 'public.user_blocks'::regclass) THEN
    ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_media_presets_pkey' AND conrelid = 'public.user_media_presets'::regclass) THEN
    ALTER TABLE public.user_media_presets ADD CONSTRAINT user_media_presets_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_mutes_pkey' AND conrelid = 'public.user_mutes'::regclass) THEN
    ALTER TABLE public.user_mutes ADD CONSTRAINT user_mutes_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_pkey' AND conrelid = 'public.venues'::regclass) THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_pkey' AND conrelid = 'public.waitlist'::regclass) THEN
    ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_pkey' AND conrelid = 'public.workout_exercises'::regclass) THEN
    ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routine_exercises_pkey' AND conrelid = 'public.workout_routine_exercises'::regclass) THEN
    ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routines_pkey' AND conrelid = 'public.workout_routines'::regclass) THEN
    ALTER TABLE public.workout_routines ADD CONSTRAINT workout_routines_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_pkey' AND conrelid = 'public.workout_sessions'::regclass) THEN
    ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_pkey' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_contacts_child_profile_id_contact_profile_id_key' AND conrelid = 'public.approved_contacts'::regclass) THEN
    ALTER TABLE public.approved_contacts ADD CONSTRAINT approved_contacts_child_profile_id_contact_profile_id_key UNIQUE (child_profile_id, contact_profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_claim_invites_token_hash_key' AND conrelid = 'public.athlete_claim_invites'::regclass) THEN
    ALTER TABLE public.athlete_claim_invites ADD CONSTRAINT athlete_claim_invites_token_hash_key UNIQUE (token_hash);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_performances_natural_key_uniq' AND conrelid = 'public.athlete_performances'::regclass) THEN
    ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_natural_key_uniq UNIQUE (natural_key);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_feed_tokens_token_hash_key' AND conrelid = 'public.calendar_feed_tokens'::regclass) THEN
    ALTER TABLE public.calendar_feed_tokens ADD CONSTRAINT calendar_feed_tokens_token_hash_key UNIQUE (token_hash);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_comment_id_profile_id_key' AND conrelid = 'public.comment_likes'::regclass) THEN
    ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_comment_id_profile_id_key UNIQUE (comment_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entry_members_uniq' AND conrelid = 'public.competition_entry_members'::regclass) THEN
    ALTER TABLE public.competition_entry_members ADD CONSTRAINT competition_entry_members_uniq UNIQUE (entry_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_standings_uniq' AND conrelid = 'public.competition_standings'::regclass) THEN
    ALTER TABLE public.competition_standings ADD CONSTRAINT competition_standings_uniq UNIQUE (competition_id, entry_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_org_season_name_uniq' AND conrelid = 'public.competitions'::regclass) THEN
    ALTER TABLE public.competitions ADD CONSTRAINT competitions_org_season_name_uniq UNIQUE NULLS NOT DISTINCT (org_id, season_id, name);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_suggestion' AND conrelid = 'public.connection_suggestions'::regclass) THEN
    ALTER TABLE public.connection_suggestions ADD CONSTRAINT unique_suggestion UNIQUE (profile_id, suggested_profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_tags_uniq' AND conrelid = 'public.contest_media_tags'::regclass) THEN
    ALTER TABLE public.contest_media_tags ADD CONSTRAINT contest_media_tags_uniq UNIQUE (media_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_participants_uniq' AND conrelid = 'public.contest_participants'::regclass) THEN
    ALTER TABLE public.contest_participants ADD CONSTRAINT contest_participants_uniq UNIQUE (contest_id, entry_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_participant_uniq' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_participant_uniq UNIQUE (participant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_stat_lines_uniq' AND conrelid = 'public.contest_stat_lines'::regclass) THEN
    ALTER TABLE public.contest_stat_lines ADD CONSTRAINT contest_stat_lines_uniq UNIQUE (contest_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_conversation_id_profile_id_key' AND conrelid = 'public.conversation_participants'::regclass) THEN
    ALTER TABLE public.conversation_participants ADD CONSTRAINT conversation_participants_conversation_id_profile_id_key UNIQUE (conversation_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'divisions_season_name_uniq' AND conrelid = 'public.divisions'::regclass) THEN
    ALTER TABLE public.divisions ADD CONSTRAINT divisions_season_name_uniq UNIQUE (season_id, name);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_claims_offer_id_rider_profile_id_key' AND conrelid = 'public.event_carpool_claims'::regclass) THEN
    ALTER TABLE public.event_carpool_claims ADD CONSTRAINT event_carpool_claims_offer_id_rider_profile_id_key UNIQUE (offer_id, rider_profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_offers_event_id_driver_profile_id_key' AND conrelid = 'public.event_carpool_offers'::regclass) THEN
    ALTER TABLE public.event_carpool_offers ADD CONSTRAINT event_carpool_offers_event_id_driver_profile_id_key UNIQUE (event_id, driver_profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facilities_id_venue_uniq' AND conrelid = 'public.facilities'::regclass) THEN
    ALTER TABLE public.facilities ADD CONSTRAINT facilities_id_venue_uniq UNIQUE (id, venue_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_follower_id_following_id_key' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_follower_id_following_id_key UNIQUE (follower_id, following_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_courses_external_source_external_id_key' AND conrelid = 'public.golf_courses'::regclass) THEN
    ALTER TABLE public.golf_courses ADD CONSTRAINT golf_courses_external_source_external_id_key UNIQUE (external_source, external_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_hole_scores_golf_participant_id_hole_number_key' AND conrelid = 'public.golf_hole_scores'::regclass) THEN
    ALTER TABLE public.golf_hole_scores ADD CONSTRAINT golf_hole_scores_golf_participant_id_hole_number_key UNIQUE (golf_participant_id, hole_number);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_holes_round_id_hole_number_key' AND conrelid = 'public.golf_holes'::regclass) THEN
    ALTER TABLE public.golf_holes ADD CONSTRAINT golf_holes_round_id_hole_number_key UNIQUE (round_id, hole_number);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_participant_scores_participant_id_key' AND conrelid = 'public.golf_participant_scores'::regclass) THEN
    ALTER TABLE public.golf_participant_scores ADD CONSTRAINT golf_participant_scores_participant_id_key UNIQUE (participant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_group_post_id_key' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_group_post_id_key UNIQUE (group_post_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_participants_group_post_id_profile_id_key' AND conrelid = 'public.group_post_participants'::regclass) THEN
    ALTER TABLE public.group_post_participants ADD CONSTRAINT group_post_participants_group_post_id_profile_id_key UNIQUE (group_post_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardian_invites_token_hash_key' AND conrelid = 'public.guardian_invites'::regclass) THEN
    ALTER TABLE public.guardian_invites ADD CONSTRAINT guardian_invites_token_hash_key UNIQUE (token_hash);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handle_history_unique_entry' AND conrelid = 'public.handle_history'::regclass) THEN
    ALTER TABLE public.handle_history ADD CONSTRAINT handle_history_unique_entry UNIQUE (profile_id, old_handle, changed_at);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'help_articles_slug_key' AND conrelid = 'public.help_articles'::regclass) THEN
    ALTER TABLE public.help_articles ADD CONSTRAINT help_articles_slug_key UNIQUE (slug);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_uniq' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_uniq UNIQUE NULLS NOT DISTINCT (org_id, profile_id, kind, scope_type, scope_id, season_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_message_id_profile_id_emoji_key' AND conrelid = 'public.message_reactions'::regclass) THEN
    ALTER TABLE public.message_reactions ADD CONSTRAINT message_reactions_message_id_profile_id_emoji_key UNIQUE (message_id, profile_id, emoji);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_user_id_key' AND conrelid = 'public.notification_preferences'::regclass) THEN
    ALTER TABLE public.notification_preferences ADD CONSTRAINT notification_preferences_user_id_key UNIQUE (user_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_claim_invites_token_hash_key' AND conrelid = 'public.org_claim_invites'::regclass) THEN
    ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_token_hash_key UNIQUE (token_hash);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_join_requests_org_profile_key' AND conrelid = 'public.org_join_requests'::regclass) THEN
    ALTER TABLE public.org_join_requests ADD CONSTRAINT org_join_requests_org_profile_key UNIQUE (org_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_modules_uniq' AND conrelid = 'public.org_site_modules'::regclass) THEN
    ALTER TABLE public.org_site_modules ADD CONSTRAINT org_site_modules_uniq UNIQUE (site_id, module_key);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_news_uniq' AND conrelid = 'public.org_site_news'::regclass) THEN
    ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_uniq UNIQUE (site_id, slug);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_pages_uniq' AND conrelid = 'public.org_site_pages'::regclass) THEN
    ALTER TABLE public.org_site_pages ADD CONSTRAINT org_site_pages_uniq UNIQUE (site_id, slug);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_org_uniq' AND conrelid = 'public.org_sites'::regclass) THEN
    ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_org_uniq UNIQUE (org_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_token_hash_key' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_token_hash_key UNIQUE (token_hash);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'places_geonames_id_key' AND conrelid = 'public.places'::regclass) THEN
    ALTER TABLE public.places ADD CONSTRAINT places_geonames_id_key UNIQUE (geonames_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_post_id_profile_id_key' AND conrelid = 'public.post_likes'::regclass) THEN
    ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_post_id_profile_id_key UNIQUE (post_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_post_tag' AND conrelid = 'public.post_tags'::regclass) THEN
    ALTER TABLE public.post_tags ADD CONSTRAINT unique_post_tag UNIQUE (post_id, tagged_profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_profile_id_key' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_profile_id_key UNIQUE (profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_access_user_id_profile_id_key' AND conrelid = 'public.profile_access'::regclass) THEN
    ALTER TABLE public.profile_access ADD CONSTRAINT profile_access_user_id_profile_id_key UNIQUE (user_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_email_key' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_key' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_season_name_uniq' AND conrelid = 'public.programs'::regclass) THEN
    ALTER TABLE public.programs ADD CONSTRAINT programs_season_name_uniq UNIQUE (season_id, name);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reg_windows_uniq' AND conrelid = 'public.registration_windows'::regclass) THEN
    ALTER TABLE public.registration_windows ADD CONSTRAINT reg_windows_uniq UNIQUE NULLS NOT DISTINCT (org_id, season_id, division_id, program_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_uniq' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_uniq UNIQUE NULLS NOT DISTINCT (org_id, profile_id, season_id, division_id, program_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_signals_profile_id_kind_window_start_key' AND conrelid = 'public.risk_signals'::regclass) THEN
    ALTER TABLE public.risk_signals ADD CONSTRAINT risk_signals_profile_id_kind_window_start_key UNIQUE (profile_id, kind, window_start);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_posts_profile_id_post_id_key' AND conrelid = 'public.saved_posts'::regclass) THEN
    ALTER TABLE public.saved_posts ADD CONSTRAINT saved_posts_profile_id_post_id_key UNIQUE (profile_id, post_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_highlights_profile_id_sport_key_season_key' AND conrelid = 'public.season_highlights'::regclass) THEN
    ALTER TABLE public.season_highlights ADD CONSTRAINT season_highlights_profile_id_sport_key_season_key UNIQUE (profile_id, sport_key, season);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_org_label_uniq' AND conrelid = 'public.seasons'::regclass) THEN
    ALTER TABLE public.seasons ADD CONSTRAINT seasons_org_label_uniq UNIQUE (org_id, label);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_group_members_position_uniq' AND conrelid = 'public.sport_event_group_members'::regclass) THEN
    ALTER TABLE public.sport_event_group_members ADD CONSTRAINT sport_event_group_members_position_uniq UNIQUE (group_id, "position");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_group_members_round_uniq' AND conrelid = 'public.sport_event_group_members'::regclass) THEN
    ALTER TABLE public.sport_event_group_members ADD CONSTRAINT sport_event_group_members_round_uniq UNIQUE (sport_event_round_id, participant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_groups_sequence_uniq' AND conrelid = 'public.sport_event_groups'::regclass) THEN
    ALTER TABLE public.sport_event_groups ADD CONSTRAINT sport_event_groups_sequence_uniq UNIQUE (sport_event_round_id, sequence);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_group_uniq' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_group_uniq UNIQUE (group_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_uniq' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_uniq UNIQUE (sport_event_id, profile_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_sequence_uniq' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_sequence_uniq UNIQUE (sport_event_id, sequence);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_stat_lines_round_participant_uniq' AND conrelid = 'public.sport_event_stat_lines'::regclass) THEN
    ALTER TABLE public.sport_event_stat_lines ADD CONSTRAINT sport_event_stat_lines_round_participant_uniq UNIQUE (sport_event_round_id, participant_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_link_token_uniq' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_link_token_uniq UNIQUE (link_token);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_settings_profile_id_sport_key_key' AND conrelid = 'public.sport_settings'::regclass) THEN
    ALTER TABLE public.sport_settings ADD CONSTRAINT sport_settings_profile_id_sport_key_key UNIQUE (profile_id, sport_key);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sports_profile_id_sport_key_key' AND conrelid = 'public.sports'::regclass) THEN
    ALTER TABLE public.sports ADD CONSTRAINT sports_profile_id_sport_key_key UNIQUE (profile_id, sport_key);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_entries_uniq' AND conrelid = 'public.team_entries'::regclass) THEN
    ALTER TABLE public.team_entries ADD CONSTRAINT team_entries_uniq UNIQUE (team_id, division_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_org_name_uniq' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_org_name_uniq UNIQUE (org_id, name);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_number_key' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_number_key UNIQUE (number);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_blocker_id_blocked_id_key' AND conrelid = 'public.user_blocks'::regclass) THEN
    ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_blocker_id_blocked_id_key UNIQUE (blocker_id, blocked_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_mutes_pair_key' AND conrelid = 'public.user_mutes'::regclass) THEN
    ALTER TABLE public.user_mutes ADD CONSTRAINT user_mutes_pair_key UNIQUE (muter_id, muted_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_email_user_type_key' AND conrelid = 'public.waitlist'::regclass) THEN
    ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_email_user_type_key UNIQUE (email, user_type);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_initiated_by_check' AND conrelid = 'public.affiliations'::regclass) THEN
    ALTER TABLE public.affiliations ADD CONSTRAINT affiliations_initiated_by_check CHECK ((initiated_by = ANY (ARRAY['child'::text, 'parent'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_no_self' AND conrelid = 'public.affiliations'::regclass) THEN
    ALTER TABLE public.affiliations ADD CONSTRAINT affiliations_no_self CHECK ((org_id <> parent_org_id));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_status_check' AND conrelid = 'public.affiliations'::regclass) THEN
    ALTER TABLE public.affiliations ADD CONSTRAINT affiliations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_type_check' AND conrelid = 'public.affiliations'::regclass) THEN
    ALTER TABLE public.affiliations ADD CONSTRAINT affiliations_type_check CHECK ((affiliation_type = ANY (ARRAY['partner_of'::text, 'member_of'::text, 'sanctioned_by'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_contacts_source_check' AND conrelid = 'public.approved_contacts'::regclass) THEN
    ALTER TABLE public.approved_contacts ADD CONSTRAINT approved_contacts_source_check CHECK ((source = ANY (ARRAY['grandfathered'::text, 'guardian'::text, 'follow'::text, 'child_initiated'::text, 'guardian_decision'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_contacts_status_check' AND conrelid = 'public.approved_contacts'::regclass) THEN
    ALTER TABLE public.approved_contacts ADD CONSTRAINT approved_contacts_status_check CHECK ((status = ANY (ARRAY['approved'::text, 'denied'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_achievements_description_check' AND conrelid = 'public.athlete_achievements'::regclass) THEN
    ALTER TABLE public.athlete_achievements ADD CONSTRAINT athlete_achievements_description_check CHECK ((char_length(description) <= 1000));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_achievements_organization_check' AND conrelid = 'public.athlete_achievements'::regclass) THEN
    ALTER TABLE public.athlete_achievements ADD CONSTRAINT athlete_achievements_organization_check CHECK ((char_length(organization) <= 120));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_achievements_placement_check' AND conrelid = 'public.athlete_achievements'::regclass) THEN
    ALTER TABLE public.athlete_achievements ADD CONSTRAINT athlete_achievements_placement_check CHECK ((char_length(placement) <= 60));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_achievements_title_check' AND conrelid = 'public.athlete_achievements'::regclass) THEN
    ALTER TABLE public.athlete_achievements ADD CONSTRAINT athlete_achievements_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_equipment_status_check' AND conrelid = 'public.athlete_equipment'::regclass) THEN
    ALTER TABLE public.athlete_equipment ADD CONSTRAINT athlete_equipment_status_check CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_retired_after_acquired' AND conrelid = 'public.athlete_equipment'::regclass) THEN
    ALTER TABLE public.athlete_equipment ADD CONSTRAINT equipment_retired_after_acquired CHECK (((retired_on IS NULL) OR (acquired_on IS NULL) OR (retired_on >= acquired_on)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_performances_dispute_check' AND conrelid = 'public.athlete_performances'::regclass) THEN
    ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_dispute_check CHECK ((dispute_status = ANY (ARRAY['none'::text, 'disputed'::text, 'resolved'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_performances_provenance_check' AND conrelid = 'public.athlete_performances'::regclass) THEN
    ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_provenance_check CHECK ((provenance = ANY (ARRAY['sanctioned'::text, 'league_verified'::text, 'club_recorded'::text, 'self_reported'::text, 'imported'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_performances_source_check' AND conrelid = 'public.athlete_performances'::regclass) THEN
    ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_source_check CHECK ((source = ANY (ARRAY['post'::text, 'live_round'::text, 'org_entry'::text, 'import'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_performances_source_table_check' AND conrelid = 'public.athlete_performances'::regclass) THEN
    ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_source_table_check CHECK ((source_table = ANY (ARRAY['posts'::text, 'golf_rounds'::text, 'contest_stat_lines'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_entrant_check' AND conrelid = 'public.competition_entries'::regclass) THEN
    ALTER TABLE public.competition_entries ADD CONSTRAINT competition_entries_entrant_check CHECK (((num_nonnulls(team_id, profile_id) = 1) OR ((team_id IS NULL) AND (profile_id IS NULL) AND (name IS NOT NULL))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_name_check' AND conrelid = 'public.competition_entries'::regclass) THEN
    ALTER TABLE public.competition_entries ADD CONSTRAINT competition_entries_name_check CHECK (((name IS NULL) OR ((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_status_check' AND conrelid = 'public.competition_entries'::regclass) THEN
    ALTER TABLE public.competition_entries ADD CONSTRAINT competition_entries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entry_members_position_check' AND conrelid = 'public.competition_entry_members'::regclass) THEN
    ALTER TABLE public.competition_entry_members ADD CONSTRAINT competition_entry_members_position_check CHECK (("position" >= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_entrant_type_check' AND conrelid = 'public.competitions'::regclass) THEN
    ALTER TABLE public.competitions ADD CONSTRAINT competitions_entrant_type_check CHECK ((entrant_type = ANY (ARRAY['team'::text, 'athlete'::text, 'ad_hoc_team'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_format_check' AND conrelid = 'public.competitions'::regclass) THEN
    ALTER TABLE public.competitions ADD CONSTRAINT competitions_format_check CHECK ((format = ANY (ARRAY['fixture'::text, 'leaderboard'::text, 'bracket'::text, 'meet'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_status_check' AND conrelid = 'public.competitions'::regclass) THEN
    ALTER TABLE public.competitions ADD CONSTRAINT competitions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'completed'::text, 'archived'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_visibility_check' AND conrelid = 'public.competitions'::regclass) THEN
    ALTER TABLE public.competitions ADD CONSTRAINT competitions_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_action_check' AND conrelid = 'public.consent_records'::regclass) THEN
    ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_action_check CHECK ((action = ANY (ARRAY['granted'::text, 'review_approved'::text, 'review_rejected'::text, 'withdrawn'::text, 'superseded'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_method_check' AND conrelid = 'public.consent_records'::regclass) THEN
    ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_method_check CHECK ((method = ANY (ARRAY['signed_form'::text, 'card_charge'::text, 'id_verification'::text, 'video_call'::text, 'email_plus'::text, 'typed_signature'::text, 'drawn_signature'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_caption_check' AND conrelid = 'public.contest_media'::regclass) THEN
    ALTER TABLE public.contest_media ADD CONSTRAINT contest_media_caption_check CHECK ((char_length(caption) <= 300));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_path_check' AND conrelid = 'public.contest_media'::regclass) THEN
    ALTER TABLE public.contest_media ADD CONSTRAINT contest_media_path_check CHECK ((storage_path ~ '^contest-media/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'::text));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_type_check' AND conrelid = 'public.contest_media'::regclass) THEN
    ALTER TABLE public.contest_media ADD CONSTRAINT contest_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_tags_status_check' AND conrelid = 'public.contest_media_tags'::regclass) THEN
    ALTER TABLE public.contest_media_tags ADD CONSTRAINT contest_media_tags_status_check CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_participants_side_check' AND conrelid = 'public.contest_participants'::regclass) THEN
    ALTER TABLE public.contest_participants ADD CONSTRAINT contest_participants_side_check CHECK ((side = ANY (ARRAY['home'::text, 'away'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_dispute_check' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_dispute_check CHECK ((dispute_status = ANY (ARRAY['none'::text, 'disputed'::text, 'resolved'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_dispute_note_len' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_dispute_note_len CHECK (((dispute_note IS NULL) OR (length(dispute_note) <= 500)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_provenance_check' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_provenance_check CHECK ((provenance = ANY (ARRAY['sanctioned'::text, 'league_verified'::text, 'club_recorded'::text, 'self_reported'::text, 'imported'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_stat_lines_provenance_check' AND conrelid = 'public.contest_stat_lines'::regclass) THEN
    ALTER TABLE public.contest_stat_lines ADD CONSTRAINT contest_stat_lines_provenance_check CHECK ((provenance = ANY (ARRAY['sanctioned'::text, 'league_verified'::text, 'club_recorded'::text, 'self_reported'::text, 'imported'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_event_source_check' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_event_source_check CHECK ((num_nonnulls(sport_event_round_id, sport_event_match_id) <= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_facility_requires_venue' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_facility_requires_venue CHECK (((facility_id IS NULL) OR (venue_id IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_holes_check' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_holes_check CHECK (((holes IS NULL) OR (holes = ANY (ARRAY[9, 18]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_play_window_check' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_play_window_check CHECK (((play_from IS NULL) OR (play_to IS NULL) OR (play_to >= play_from)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_stage_slot_check' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_stage_slot_check CHECK ((((stage IS NULL) AND (slot IS NULL)) OR ((stage >= 1) AND (slot >= 1))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_status_check' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text, 'canceled'::text, 'postponed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_role_check' AND conrelid = 'public.conversation_participants'::regclass) THEN
    ALTER TABLE public.conversation_participants ADD CONSTRAINT conversation_participants_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_type_check' AND conrelid = 'public.conversations'::regclass) THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_type_check CHECK ((type = ANY (ARRAY['direct'::text, 'group'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_claims_seats_check' AND conrelid = 'public.event_carpool_claims'::regclass) THEN
    ALTER TABLE public.event_carpool_claims ADD CONSTRAINT event_carpool_claims_seats_check CHECK (((seats >= 1) AND (seats <= 4)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_offers_note_check' AND conrelid = 'public.event_carpool_offers'::regclass) THEN
    ALTER TABLE public.event_carpool_offers ADD CONSTRAINT event_carpool_offers_note_check CHECK ((char_length(note) <= 200));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_offers_seats_total_check' AND conrelid = 'public.event_carpool_offers'::regclass) THEN
    ALTER TABLE public.event_carpool_offers ADD CONSTRAINT event_carpool_offers_seats_total_check CHECK (((seats_total >= 1) AND (seats_total <= 8)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_guests_check' AND conrelid = 'public.event_guests'::regclass) THEN
    ALTER TABLE public.event_guests ADD CONSTRAINT event_guests_check CHECK ((num_nonnulls(profile_id, invited_email) = 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_guests_invited_email_check' AND conrelid = 'public.event_guests'::regclass) THEN
    ALTER TABLE public.event_guests ADD CONSTRAINT event_guests_invited_email_check CHECK ((invited_email = lower(invited_email)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_guests_reminder_minutes_check' AND conrelid = 'public.event_guests'::regclass) THEN
    ALTER TABLE public.event_guests ADD CONSTRAINT event_guests_reminder_minutes_check CHECK (((reminder_minutes >= 0) AND (reminder_minutes <= 10080)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_guests_role_check' AND conrelid = 'public.event_guests'::regclass) THEN
    ALTER TABLE public.event_guests ADD CONSTRAINT event_guests_role_check CHECK ((role = ANY (ARRAY['organizer'::text, 'guest'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_guests_status_check' AND conrelid = 'public.event_guests'::regclass) THEN
    ALTER TABLE public.event_guests ADD CONSTRAINT event_guests_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'accepted'::text, 'declined'::text, 'maybe'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_byweekday_check' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_byweekday_check CHECK ((byweekday <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_check' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_check CHECK (((ends <> 'until'::text) OR (until_at IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_check1' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_check1 CHECK (((ends <> 'count'::text) OR (count_n IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_check2' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_check2 CHECK (((freq = 'weekly'::text) OR (byweekday IS NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_count_n_check' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_count_n_check CHECK (((count_n >= 1) AND (count_n <= 104)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_ends_check' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_ends_check CHECK ((ends = ANY (ARRAY['never'::text, 'until'::text, 'count'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_freq_check' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_freq_check CHECK ((freq = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'yearly'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_interval_n_check' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_interval_n_check CHECK (((interval_n >= 1) AND (interval_n <= 12)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_category_check' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_category_check CHECK ((category = ANY (ARRAY['general'::text, 'practice'::text, 'game'::text, 'tournament'::text, 'training'::text, 'social'::text, 'other'::text, 'workout'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_check' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_check CHECK ((ends_at > starts_at));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_description_check' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_description_check CHECK ((char_length(description) <= 2000));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_facility_requires_venue' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_facility_requires_venue CHECK (((facility_id IS NULL) OR (venue_id IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_location_check' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_location_check CHECK ((char_length(location) <= 200));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_one_scope_check' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_one_scope_check CHECK ((num_nonnulls(org_id, division_id, team_id) <= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_status_check' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_timezone_check' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_timezone_check CHECK ((char_length(timezone) <= 64));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_title_check' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_status_check' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_courses_section_kind_check' AND conrelid = 'public.golf_courses'::regclass) THEN
    ALTER TABLE public.golf_courses ADD CONSTRAINT golf_courses_section_kind_check CHECK (((section_kind IS NULL) OR (section_kind = ANY (ARRAY['course_18'::text, 'nine'::text, 'unspecified'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_hole_scores_check' AND conrelid = 'public.golf_hole_scores'::regclass) THEN
    ALTER TABLE public.golf_hole_scores ADD CONSTRAINT golf_hole_scores_check CHECK (((putts IS NULL) OR ((putts >= 0) AND (putts <= strokes))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_hole_scores_hole_number_check' AND conrelid = 'public.golf_hole_scores'::regclass) THEN
    ALTER TABLE public.golf_hole_scores ADD CONSTRAINT golf_hole_scores_hole_number_check CHECK (((hole_number > 0) AND (hole_number <= 18)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_hole_scores_strokes_check' AND conrelid = 'public.golf_hole_scores'::regclass) THEN
    ALTER TABLE public.golf_hole_scores ADD CONSTRAINT golf_hole_scores_strokes_check CHECK (((strokes > 0) AND (strokes <= 15)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_hole_scores_version_check' AND conrelid = 'public.golf_hole_scores'::regclass) THEN
    ALTER TABLE public.golf_hole_scores ADD CONSTRAINT golf_hole_scores_version_check CHECK ((version >= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_holes_hole_number_check' AND conrelid = 'public.golf_holes'::regclass) THEN
    ALTER TABLE public.golf_holes ADD CONSTRAINT golf_holes_hole_number_check CHECK (((hole_number >= 1) AND (hole_number <= 18)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_holes_par_check' AND conrelid = 'public.golf_holes'::regclass) THEN
    ALTER TABLE public.golf_holes ADD CONSTRAINT golf_holes_par_check CHECK (((par >= 3) AND (par <= 6)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_holes_putts_check' AND conrelid = 'public.golf_holes'::regclass) THEN
    ALTER TABLE public.golf_holes ADD CONSTRAINT golf_holes_putts_check CHECK (((putts >= 0) AND (putts <= 8)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_holes_strokes_check' AND conrelid = 'public.golf_holes'::regclass) THEN
    ALTER TABLE public.golf_holes ADD CONSTRAINT golf_holes_strokes_check CHECK (((strokes >= 1) AND (strokes <= 15)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_participant_scores_status_check' AND conrelid = 'public.golf_participant_scores'::regclass) THEN
    ALTER TABLE public.golf_participant_scores ADD CONSTRAINT golf_participant_scores_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'submitted'::text, 'final'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_participant_scores_submitted_check' AND conrelid = 'public.golf_participant_scores'::regclass) THEN
    ALTER TABLE public.golf_participant_scores ADD CONSTRAINT golf_participant_scores_submitted_check CHECK (((status = 'in_progress'::text) OR (submitted_at IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_fir_percentage_check' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_fir_percentage_check CHECK (((fir_percentage >= (0)::numeric) AND (fir_percentage <= (100)::numeric)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_gir_percentage_check' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_gir_percentage_check CHECK (((gir_percentage >= (0)::numeric) AND (gir_percentage <= (100)::numeric)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_round_type_check' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_round_type_check CHECK ((round_type = ANY (ARRAY['outdoor'::text, 'indoor'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_game_format_check' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_game_format_check CHECK ((game_format = ANY (ARRAY['stroke'::text, 'stableford'::text, 'match'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_holes_played_check' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_holes_played_check CHECK (((holes_played > 0) AND (holes_played <= 18)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_round_type_check' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_round_type_check CHECK ((round_type = ANY (ARRAY['outdoor'::text, 'indoor'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_media_media_type_check' AND conrelid = 'public.group_post_media'::regclass) THEN
    ALTER TABLE public.group_post_media ADD CONSTRAINT group_post_media_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_media_segment_number_positive' AND conrelid = 'public.group_post_media'::regclass) THEN
    ALTER TABLE public.group_post_media ADD CONSTRAINT group_post_media_segment_number_positive CHECK (((segment_number IS NULL) OR (segment_number > 0)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_participants_role_check' AND conrelid = 'public.group_post_participants'::regclass) THEN
    ALTER TABLE public.group_post_participants ADD CONSTRAINT group_post_participants_role_check CHECK ((role = ANY (ARRAY['creator'::text, 'participant'::text, 'organizer'::text, 'spectator'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_participants_status_check' AND conrelid = 'public.group_post_participants'::regclass) THEN
    ALTER TABLE public.group_post_participants ADD CONSTRAINT group_post_participants_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'declined'::text, 'maybe'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_posts_status_check' AND conrelid = 'public.group_posts'::regclass) THEN
    ALTER TABLE public.group_posts ADD CONSTRAINT group_posts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'completed'::text, 'cancelled'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_posts_type_check' AND conrelid = 'public.group_posts'::regclass) THEN
    ALTER TABLE public.group_posts ADD CONSTRAINT group_posts_type_check CHECK ((type = ANY (ARRAY['golf_round'::text, 'hockey_game'::text, 'volleyball_match'::text, 'basketball_game'::text, 'social_event'::text, 'practice_session'::text, 'tournament_round'::text, 'watch_party'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_posts_visibility_check' AND conrelid = 'public.group_posts'::regclass) THEN
    ALTER TABLE public.group_posts ADD CONSTRAINT group_posts_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text, 'participants_only'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardian_invites_check' AND conrelid = 'public.guardian_invites'::regclass) THEN
    ALTER TABLE public.guardian_invites ADD CONSTRAINT guardian_invites_check CHECK ((num_nonnulls(pending_profile_id, profile_id) = 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardian_invites_grant_role_check' AND conrelid = 'public.guardian_invites'::regclass) THEN
    ALTER TABLE public.guardian_invites ADD CONSTRAINT guardian_invites_grant_role_check CHECK ((grant_role = ANY (ARRAY['guardian'::text, 'viewer'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardian_invites_invite_type_check' AND conrelid = 'public.guardian_invites'::regclass) THEN
    ALTER TABLE public.guardian_invites ADD CONSTRAINT guardian_invites_invite_type_check CHECK ((invite_type = ANY (ARRAY['guardian_for_pending'::text, 'guardian_additional'::text, 'athlete_activation'::text, 'transfer_contact_verify'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'help_articles_body_length' AND conrelid = 'public.help_articles'::regclass) THEN
    ALTER TABLE public.help_articles ADD CONSTRAINT help_articles_body_length CHECK ((length(body) <= 20000));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'help_articles_slug_shape' AND conrelid = 'public.help_articles'::regclass) THEN
    ALTER TABLE public.help_articles ADD CONSTRAINT help_articles_slug_shape CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND ((length(slug) >= 2) AND (length(slug) <= 80))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'help_articles_title_length' AND conrelid = 'public.help_articles'::regclass) THEN
    ALTER TABLE public.help_articles ADD CONSTRAINT help_articles_title_length CHECK (((length(title) >= 1) AND (length(title) <= 140)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'help_articles_topic_check' AND conrelid = 'public.help_articles'::regclass) THEN
    ALTER TABLE public.help_articles ADD CONSTRAINT help_articles_topic_check CHECK ((topic = ANY (ARRAY['getting_started'::text, 'posting_media'::text, 'events'::text, 'organizations'::text, 'family'::text, 'privacy_safety'::text, 'account'::text, 'other'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_kind_check' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_kind_check CHECK ((kind = ANY (ARRAY['follow'::text, 'roster'::text, 'staff'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_org_scope_check' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_org_scope_check CHECK ((((scope_type = 'org'::text) AND (scope_id IS NULL)) OR ((scope_type <> 'org'::text) AND (scope_id IS NOT NULL))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_role_check' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'member'::text, 'admin'::text, 'staff'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_scope_type_check' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_scope_type_check CHECK ((scope_type = ANY (ARRAY['org'::text, 'division'::text, 'team'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_staff_shape_check' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_staff_shape_check CHECK ((((kind <> 'staff'::text) AND (role <> ALL (ARRAY['admin'::text, 'staff'::text])) AND (sections IS NULL)) OR ((kind = 'staff'::text) AND (role = 'admin'::text) AND (scope_type = 'org'::text) AND (sections IS NULL)) OR ((kind = 'staff'::text) AND (role = 'staff'::text) AND (cardinality(sections) >= 1) AND (sections <@ ARRAY['website'::text, 'roster'::text, 'membership'::text, 'seasons'::text, 'teams'::text, 'competitions'::text, 'registrations'::text, 'external'::text, 'venues'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_status_check' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'registered'::text, 'evaluating'::text, 'placed'::text, 'released'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reports_reason_check' AND conrelid = 'public.message_reports'::regclass) THEN
    ALTER TABLE public.message_reports ADD CONSTRAINT message_reports_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'hateful'::text, 'sexual'::text, 'violence'::text, 'other'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reports_status_check' AND conrelid = 'public.message_reports'::regclass) THEN
    ALTER TABLE public.message_reports ADD CONSTRAINT message_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'reviewing'::text, 'resolved'::text, 'dismissed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_type_check' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_type_check CHECK ((type = ANY (ARRAY['text'::text, 'image'::text, 'video'::text, 'shared_post'::text, 'shared_profile'::text, 'gif_reaction'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_action_status_check' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_action_status_check CHECK ((action_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['follow_request'::text, 'follow_accepted'::text, 'new_follower'::text, 'like'::text, 'comment'::text, 'comment_reply'::text, 'mention'::text, 'tag'::text, 'achievement'::text, 'system_announcement'::text, 'club_update'::text, 'team_update'::text, 'new_message'::text, 'group_invite'::text, 'group_update'::text, 'guardian_invite'::text, 'athlete_added'::text, 'event_invite'::text, 'event_update'::text, 'event_cancelled'::text, 'event_response'::text, 'event_reminder'::text, 'post_pending_approval'::text, 'post_approval_result'::text, 'transfer_update'::text, 'consent_result'::text, 'comment_pending_approval'::text, 'comment_approval_result'::text, 'follow_request_guardian'::text, 'follow_update'::text, 'tag_alert'::text, 'profile_change'::text, 'calendar_alert'::text, 'safety_alert'::text, 'league_join'::text, 'league_update'::text, 'league_request_result'::text, 'club_join'::text, 'club_request_result'::text, 'affiliation_invite'::text, 'affiliation_update'::text, 'carpool_offer'::text, 'carpool_update'::text, 'roster_invite'::text, 'competition_entry_pending'::text, 'competition_entry_decided'::text, 'org_registration_received'::text, 'org_registration_placed'::text, 'org_registration_released'::text, 'contest_dispute_raised'::text, 'contest_dispute_resolved'::text, 'golf_league_round_counted'::text, 'golf_league_round_confirmed'::text, 'golf_league_window_closing'::text, 'org_staff_invite'::text, 'org_staff_accepted'::text, 'org_staff_revoked'::text, 'org_listing_request'::text, 'site_form_submission'::text, 'sport_event_invite'::text, 'sport_event_request'::text, 'sport_event_request_decision'::text, 'sport_event_live'::text, 'sport_event_results'::text, 'sport_event_reminder'::text, 'sport_event_match'::text, 'ticket_update'::text, 'ticket_critical'::text, 'moderation_notice'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_requests_kind_check' AND conrelid = 'public.org_requests'::regclass) THEN
    ALTER TABLE public.org_requests ADD CONSTRAINT org_requests_kind_check CHECK ((kind = ANY (ARRAY['league'::text, 'club'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_requests_league_sport_key_check' AND conrelid = 'public.org_requests'::regclass) THEN
    ALTER TABLE public.org_requests ADD CONSTRAINT org_requests_league_sport_key_check CHECK (((kind <> 'league'::text) OR (sport_key IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_requests_status_check' AND conrelid = 'public.org_requests'::regclass) THEN
    ALTER TABLE public.org_requests ADD CONSTRAINT org_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'unlisted'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_form_submissions_kind_check' AND conrelid = 'public.org_site_form_submissions'::regclass) THEN
    ALTER TABLE public.org_site_form_submissions ADD CONSTRAINT org_site_form_submissions_kind_check CHECK ((kind = ANY (ARRAY['contact'::text, 'interest'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_modules_key_check' AND conrelid = 'public.org_site_modules'::regclass) THEN
    ALTER TABLE public.org_site_modules ADD CONSTRAINT org_site_modules_key_check CHECK ((module_key = ANY (ARRAY['hero'::text, 'standings'::text, 'schedule'::text, 'teams'::text, 'staff'::text, 'venues'::text, 'affiliations'::text, 'sponsors'::text, 'contact'::text, 'news'::text, 'gallery'::text, 'register'::text, 'courses'::text, 'divisions'::text, 'leaders'::text, 'documents'::text, 'members'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_news_audience_check' AND conrelid = 'public.org_site_news'::regclass) THEN
    ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_audience_check CHECK ((audience = ANY (ARRAY['public'::text, 'members'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_news_slug_check' AND conrelid = 'public.org_site_news'::regclass) THEN
    ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_slug_check CHECK (((slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'::text) AND (char_length(slug) <= 80)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_news_title_check' AND conrelid = 'public.org_site_news'::regclass) THEN
    ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_pages_slug_check' AND conrelid = 'public.org_site_pages'::regclass) THEN
    ALTER TABLE public.org_site_pages ADD CONSTRAINT org_site_pages_slug_check CHECK (((slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'::text) AND (char_length(slug) <= 80)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_pages_title_check' AND conrelid = 'public.org_site_pages'::regclass) THEN
    ALTER TABLE public.org_site_pages ADD CONSTRAINT org_site_pages_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_pages_visibility_check' AND conrelid = 'public.org_site_pages'::regclass) THEN
    ALTER TABLE public.org_site_pages ADD CONSTRAINT org_site_pages_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'draft'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_revisions_label_check' AND conrelid = 'public.org_site_revisions'::regclass) THEN
    ALTER TABLE public.org_site_revisions ADD CONSTRAINT org_site_revisions_label_check CHECK (((label IS NULL) OR ((char_length(label) >= 1) AND (char_length(label) <= 60))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_custom_domain_check' AND conrelid = 'public.org_sites'::regclass) THEN
    ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_custom_domain_check CHECK (((custom_domain IS NULL) OR ((length(custom_domain) <= 253) AND (custom_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'::text))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_domain_vercel_state_check' AND conrelid = 'public.org_sites'::regclass) THEN
    ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_domain_vercel_state_check CHECK (((domain_vercel_state IS NULL) OR (domain_vercel_state = ANY (ARRAY['pending'::text, 'attached'::text, 'failed'::text, 'detached'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_subdomain_check' AND conrelid = 'public.org_sites'::regclass) THEN
    ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_subdomain_check CHECK (((subdomain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'::text) AND ((char_length(subdomain) >= 3) AND (char_length(subdomain) <= 63))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_template_check' AND conrelid = 'public.org_sites'::regclass) THEN
    ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_template_check CHECK ((template_id = ANY (ARRAY['classic'::text, 'bold'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_audit_action_check' AND conrelid = 'public.org_staff_audit'::regclass) THEN
    ALTER TABLE public.org_staff_audit ADD CONSTRAINT org_staff_audit_action_check CHECK ((action = ANY (ARRAY['invited'::text, 'accepted'::text, 'changed'::text, 'revoked'::text, 'expired'::text, 'invite_revoked'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_role_check' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'staff'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_scope' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_scope CHECK (((scope_type = 'org'::text) = (scope_id IS NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_scope_type_check' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_scope_type_check CHECK ((scope_type = ANY (ARRAY['org'::text, 'division'::text, 'team'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_shape' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_shape CHECK ((((role = 'admin'::text) AND (scope_type = 'org'::text) AND (sections IS NULL)) OR ((role = 'staff'::text) AND (cardinality(sections) >= 1) AND (sections <@ ARRAY['website'::text, 'roster'::text, 'membership'::text, 'seasons'::text, 'teams'::text, 'competitions'::text, 'registrations'::text, 'external'::text, 'venues'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_join_policy_check' AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_join_policy_check CHECK ((join_policy = ANY (ARRAY['open'::text, 'approval'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_kind_check' AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_kind_check CHECK ((kind = ANY (ARRAY['league'::text, 'club'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_league_sport_key_check' AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_league_sport_key_check CHECK (((kind <> 'league'::text) OR (sport_key IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_listing_status_check' AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_listing_status_check CHECK ((listing_status = ANY (ARRAY['unlisted'::text, 'pending'::text, 'listed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_visibility_check' AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_profiles_state_check' AND conrelid = 'public.pending_profiles'::regclass) THEN
    ALTER TABLE public.pending_profiles ADD CONSTRAINT pending_profiles_state_check CHECK ((state = ANY (ARRAY['awaiting_guardian'::text, 'consent_pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performances_athletic_score_check' AND conrelid = 'public.performances'::regclass) THEN
    ALTER TABLE public.performances ADD CONSTRAINT performances_athletic_score_check CHECK (((athletic_score >= (0)::numeric) AND (athletic_score <= (100)::numeric)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_admins_role_check' AND conrelid = 'public.platform_admins'::regclass) THEN
    ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'moderator'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_status_check' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_status_check CHECK ((status = ANY (ARRAY['published'::text, 'pending_approval'::text, 'rejected'::text, 'changes_requested'::text, 'hidden'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_media_media_type_check' AND conrelid = 'public.post_media'::regclass) THEN
    ALTER TABLE public.post_media ADD CONSTRAINT post_media_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_tags_status_check' AND conrelid = 'public.post_tags'::regclass) THEN
    ALTER TABLE public.post_tags ADD CONSTRAINT post_tags_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'removed'::text, 'declined'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_golf_sources' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT check_golf_sources CHECK ((NOT ((round_id IS NOT NULL) AND (group_post_id IS NOT NULL))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_status_check' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_status_check CHECK ((status = ANY (ARRAY['published'::text, 'pending_approval'::text, 'rejected'::text, 'changes_requested'::text, 'hidden'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_visibility_check' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text, 'followers'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_activity_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_activity_visibility_check CHECK ((activity_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_media_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_media_visibility_check CHECK ((media_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_posts_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_posts_visibility_check CHECK ((posts_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_profile_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_profile_visibility_check CHECK ((profile_visibility = ANY (ARRAY['public'::text, 'private'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_stats_visibility_check' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_stats_visibility_check CHECK ((stats_visibility = ANY (ARRAY['public'::text, 'private'::text, 'friends'::text, 'inherit'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_role_identity' AND conrelid = 'public.profile_access'::regclass) THEN
    ALTER TABLE public.profile_access ADD CONSTRAINT check_role_identity CHECK ((((role = ANY (ARRAY['owner'::text, 'supervised'::text])) AND (user_id = profile_id)) OR ((role = ANY (ARRAY['guardian'::text, 'viewer'::text])) AND (user_id <> profile_id))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_access_role_check' AND conrelid = 'public.profile_access'::regclass) THEN
    ALTER TABLE public.profile_access ADD CONSTRAINT profile_access_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'guardian'::text, 'supervised'::text, 'viewer'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_access_audit_action_check' AND conrelid = 'public.profile_access_audit'::regclass) THEN
    ALTER TABLE public.profile_access_audit ADD CONSTRAINT profile_access_audit_action_check CHECK ((action = ANY (ARRAY['granted'::text, 'revoked'::text, 'role_changed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_transfers_age_preset_prompt_check' AND conrelid = 'public.profile_transfers'::regclass) THEN
    ALTER TABLE public.profile_transfers ADD CONSTRAINT profile_transfers_age_preset_prompt_check CHECK (((age_preset_prompt IS NULL) OR (age_preset_prompt = ANY (ARRAY['pending'::text, 'applied'::text, 'kept'::text, 'none'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_transfers_guardian_post_role_check' AND conrelid = 'public.profile_transfers'::regclass) THEN
    ALTER TABLE public.profile_transfers ADD CONSTRAINT profile_transfers_guardian_post_role_check CHECK ((guardian_post_role = ANY (ARRAY['viewer'::text, 'removed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_transfers_initiated_by_check' AND conrelid = 'public.profile_transfers'::regclass) THEN
    ALTER TABLE public.profile_transfers ADD CONSTRAINT profile_transfers_initiated_by_check CHECK ((initiated_by = ANY (ARRAY['guardian'::text, 'athlete'::text, 'system'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_transfers_state_check' AND conrelid = 'public.profile_transfers'::regclass) THEN
    ALTER TABLE public.profile_transfers ADD CONSTRAINT profile_transfers_state_check CHECK ((state = ANY (ARRAY['eligible_notified'::text, 'requested'::text, 'initiated'::text, 'credentials_pending'::text, 'dual_confirm'::text, 'cooling_off'::text, 'executing'::text, 'completed'::text, 'cancelled'::text, 'expired'::text, 'aborted'::text, 'failed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_display_name_not_empty' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT check_display_name_not_empty CHECK (((display_name IS NOT NULL) AND (length(TRIM(BOTH FROM display_name)) > 0)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_comment_moderation_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_comment_moderation_check CHECK ((comment_moderation = ANY (ARRAY['instant'::text, 'held'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_gender_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'custom'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_messaging_permission_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_messaging_permission_check CHECK ((messaging_permission = ANY (ARRAY['everyone'::text, 'fans_only'::text, 'mutual_fans'::text, 'nobody'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_moderation_state_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_moderation_state_check CHECK ((moderation_state = ANY (ARRAY['active'::text, 'limited'::text, 'suspended'::text, 'banned'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_recruiting_status_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_recruiting_status_check CHECK ((recruiting_status = ANY (ARRAY['closed'::text, 'open'::text, 'committed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_scout_affiliation_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_scout_affiliation_check CHECK (((scout_affiliation IS NULL) OR (char_length(scout_affiliation) <= 120)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_supervision_state_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_supervision_state_check CHECK ((supervision_state = ANY (ARRAY['self'::text, 'supervised'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_user_type_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_type_check CHECK ((user_type = ANY (ARRAY['athlete'::text, 'club'::text, 'league'::text, 'fan'::text, 'parent'::text, 'organizer'::text, 'scout'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_visibility_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_capacity_check' AND conrelid = 'public.programs'::regclass) THEN
    ALTER TABLE public.programs ADD CONSTRAINT programs_capacity_check CHECK (((capacity_estimate IS NULL) OR (capacity_estimate > 0)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_name_check' AND conrelid = 'public.programs'::regclass) THEN
    ALTER TABLE public.programs ADD CONSTRAINT programs_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reg_windows_capacity_check' AND conrelid = 'public.registration_windows'::regclass) THEN
    ALTER TABLE public.registration_windows ADD CONSTRAINT reg_windows_capacity_check CHECK (((capacity IS NULL) OR (capacity > 0)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reg_windows_offering_check' AND conrelid = 'public.registration_windows'::regclass) THEN
    ALTER TABLE public.registration_windows ADD CONSTRAINT reg_windows_offering_check CHECK ((num_nonnulls(division_id, program_id) <= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_offering_check' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_offering_check CHECK ((num_nonnulls(division_id, program_id) <= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_reason_check' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_reason_check CHECK ((char_length(released_reason) <= 300));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_signals_kind_check' AND conrelid = 'public.risk_signals'::regclass) THEN
    ALTER TABLE public.risk_signals ADD CONSTRAINT risk_signals_kind_check CHECK ((kind = ANY (ARRAY['new_contact_burst'::text, 'message_volume_spike'::text, 'report_filed'::text, 'late_night_activity'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'safety_settings_audit_field_check' AND conrelid = 'public.safety_settings_audit'::regclass) THEN
    ALTER TABLE public.safety_settings_audit ADD CONSTRAINT safety_settings_audit_field_check CHECK ((field = ANY (ARRAY['visibility'::text, 'messaging_permission'::text, 'comment_moderation'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scout_shortlists_not_self' AND conrelid = 'public.scout_shortlists'::regclass) THEN
    ALTER TABLE public.scout_shortlists ADD CONSTRAINT scout_shortlists_not_self CHECK ((scout_id <> athlete_id));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scout_shortlists_note_check' AND conrelid = 'public.scout_shortlists'::regclass) THEN
    ALTER TABLE public.scout_shortlists ADD CONSTRAINT scout_shortlists_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'search_documents_entity_type_check' AND conrelid = 'public.search_documents'::regclass) THEN
    ALTER TABLE public.search_documents ADD CONSTRAINT search_documents_entity_type_check CHECK ((entity_type = ANY (ARRAY['athlete'::text, 'club'::text, 'course'::text, 'post'::text, 'league'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_highlights_rating_check' AND conrelid = 'public.season_highlights'::regclass) THEN
    ALTER TABLE public.season_highlights ADD CONSTRAINT season_highlights_rating_check CHECK (((rating >= (0)::numeric) AND (rating <= (100)::numeric)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_date_order_check' AND conrelid = 'public.seasons'::regclass) THEN
    ALTER TABLE public.seasons ADD CONSTRAINT seasons_date_order_check CHECK (((starts_on IS NULL) OR (ends_on IS NULL) OR (ends_on >= starts_on)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_group_members_position_check' AND conrelid = 'public.sport_event_group_members'::regclass) THEN
    ALTER TABLE public.sport_event_group_members ADD CONSTRAINT sport_event_group_members_position_check CHECK (("position" >= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_group_members_side_check' AND conrelid = 'public.sport_event_group_members'::regclass) THEN
    ALTER TABLE public.sport_event_group_members ADD CONSTRAINT sport_event_group_members_side_check CHECK (((side IS NULL) OR (side = ANY (ARRAY[1, 2]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_groups_name_check' AND conrelid = 'public.sport_event_groups'::regclass) THEN
    ALTER TABLE public.sport_event_groups ADD CONSTRAINT sport_event_groups_name_check CHECK (((name IS NULL) OR ((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_groups_sequence_check' AND conrelid = 'public.sport_event_groups'::regclass) THEN
    ALTER TABLE public.sport_event_groups ADD CONSTRAINT sport_event_groups_sequence_check CHECK ((sequence >= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_groups_starting_hole_check' AND conrelid = 'public.sport_event_groups'::regclass) THEN
    ALTER TABLE public.sport_event_groups ADD CONSTRAINT sport_event_groups_starting_hole_check CHECK (((starting_hole >= 1) AND (starting_hole <= 18)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_concessions_check' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_concessions_check CHECK ((jsonb_typeof(concessions) = 'array'::text));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_decided_by_check' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_decided_by_check CHECK (((decided_by IS NULL) OR (decided_by = ANY (ARRAY['holes'::text, 'concession'::text, 'extra_holes'::text, 'organizer'::text, 'bye'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_decided_check' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_decided_check CHECK ((((decided_by IS NULL) = (winner_side IS NULL)) AND ((decided_by IS NULL) = (result IS NULL)) AND ((decided_by IS NULL) = (decided_at IS NULL))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_extra_holes_check' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_extra_holes_check CHECK ((jsonb_typeof(extra_holes) = 'array'::text));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_result_check' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_result_check CHECK (((result IS NULL) OR ((length(btrim(result)) >= 1) AND (length(btrim(result)) <= 40))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_version_check' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_version_check CHECK ((version >= 0));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_winner_side_check' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_winner_side_check CHECK (((winner_side IS NULL) OR (winner_side = ANY (ARRAY[1, 2]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_media_caption_check' AND conrelid = 'public.sport_event_media'::regclass) THEN
    ALTER TABLE public.sport_event_media ADD CONSTRAINT sport_event_media_caption_check CHECK (((caption IS NULL) OR (length(caption) <= 500)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_media_duration_check' AND conrelid = 'public.sport_event_media'::regclass) THEN
    ALTER TABLE public.sport_event_media ADD CONSTRAINT sport_event_media_duration_check CHECK (((duration_seconds IS NULL) OR (duration_seconds > (0)::numeric)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_media_type_check' AND conrelid = 'public.sport_event_media'::regclass) THEN
    ALTER TABLE public.sport_event_media ADD CONSTRAINT sport_event_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_media_url_check' AND conrelid = 'public.sport_event_media'::regclass) THEN
    ALTER TABLE public.sport_event_media ADD CONSTRAINT sport_event_media_url_check CHECK (((length(btrim(media_url)) >= 1) AND (length(btrim(media_url)) <= 2000)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_flight_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_flight_check CHECK (((flight IS NULL) OR ((length(btrim(flight)) >= 1) AND (length(btrim(flight)) <= 20))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_follower_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_follower_check CHECK (((role <> 'follower'::text) OR (playing = false)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_hcp_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_hcp_check CHECK (((handicap_source = 'none'::text) = (handicap_index IS NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_hcp_source_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_hcp_source_check CHECK ((handicap_source = ANY (ARRAY['computed'::text, 'organizer'::text, 'none'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_index_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_index_check CHECK (((handicap_index IS NULL) OR ((handicap_index >= '-10.0'::numeric) AND (handicap_index <= 54.0))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_role_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_role_check CHECK ((role = ANY (ARRAY['organizer'::text, 'co_organizer'::text, 'participant'::text, 'follower'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_status_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'requested'::text, 'accepted'::text, 'declined'::text, 'removed'::text, 'withdrawn'::text, 'waitlisted'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_waitlist_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_waitlist_check CHECK (((status = 'waitlisted'::text) = (waitlist_position IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_waitlist_pos_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_waitlist_pos_check CHECK (((waitlist_position IS NULL) OR (waitlist_position >= 1)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_course_name_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_course_name_check CHECK (((length(btrim(course_name)) >= 1) AND (length(btrim(course_name)) <= 200)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_holes_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_holes_check CHECK ((holes = ANY (ARRAY[9, 18])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_name_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_name_check CHECK (((name IS NULL) OR ((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 40))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_period_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_period_check CHECK (((period IS NULL) OR (period >= 1)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_score_version_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_score_version_check CHECK ((score_version >= 0));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_sequence_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_sequence_check CHECK ((sequence >= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_side1_score_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_side1_score_check CHECK (((side1_score IS NULL) OR (side1_score >= 0)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_side2_score_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_side2_score_check CHECK (((side2_score IS NULL) OR (side2_score >= 0)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_slope_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_slope_check CHECK (((slope_rating IS NULL) OR ((slope_rating >= 55) AND (slope_rating <= 155))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_starting_hole_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_starting_hole_check CHECK ((starting_hole = ANY (ARRAY[1, 10])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_status_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'live'::text, 'completed'::text, 'cancelled'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_timezone_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_timezone_check CHECK (((timezone IS NULL) OR ((length(timezone) >= 1) AND (length(timezone) <= 64))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_stat_lines_stats_check' AND conrelid = 'public.sport_event_stat_lines'::regclass) THEN
    ALTER TABLE public.sport_event_stat_lines ADD CONSTRAINT sport_event_stat_lines_stats_check CHECK ((jsonb_typeof(stats) = 'object'::text));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_stat_lines_version_check' AND conrelid = 'public.sport_event_stat_lines'::regclass) THEN
    ALTER TABLE public.sport_event_stat_lines ADD CONSTRAINT sport_event_stat_lines_version_check CHECK ((version >= 0));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_capacity_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_capacity_check CHECK (((capacity IS NULL) OR (capacity >= 1)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_description_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_description_check CHECK (((description IS NULL) OR (length(description) <= 2000)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_format_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_format_check CHECK ((format = ANY (ARRAY['stroke_gross'::text, 'stroke_net'::text, 'match_gross'::text, 'match_net'::text, 'stableford_gross'::text, 'stableford_net'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_format_config_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_format_config_check CHECK ((jsonb_typeof(format_config) = 'object'::text));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_join_mode_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_join_mode_check CHECK ((join_mode = ANY (ARRAY['invite'::text, 'request'::text, 'open'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_link_token_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_link_token_check CHECK (((visibility <> 'link'::text) OR (link_token IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_name_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_shape_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_shape_check CHECK ((shape = ANY (ARRAY['round'::text, 'game'::text, 'session'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_sport_shape_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_sport_shape_check CHECK (((sport_key = 'golf'::text) = (shape = 'round'::text)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_status_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'live'::text, 'completed'::text, 'cancelled'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_visibility_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'link'::text, 'private'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_status_check' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_events_kind_check' AND conrelid = 'public.ticket_events'::regclass) THEN
    ALTER TABLE public.ticket_events ADD CONSTRAINT ticket_events_kind_check CHECK ((kind = ANY (ARRAY['created'::text, 'status_changed'::text, 'severity_changed'::text, 'assigned'::text, 'note'::text, 'reply_to_user'::text, 'user_reply'::text, 'merged'::text, 'action_taken'::text, 'email_sent'::text, 'reopened'::text, 'anonymized'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_report_count_check' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_report_count_check CHECK ((report_count >= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_resolution_code_check' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_resolution_code_check CHECK (((resolution_code IS NULL) OR (resolution_code = ANY (ARRAY['no_action'::text, 'content_removed'::text, 'warning'::text, 'suspension'::text, 'ban'::text, 'feature_shipped'::text, 'declined'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_resolution_shape' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_resolution_shape CHECK (((status = ANY (ARRAY['resolved'::text, 'closed'::text])) OR (resolution_code IS NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_severity_check' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_status_check' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check CHECK ((status = ANY (ARRAY['new'::text, 'in_review'::text, 'waiting_on_user'::text, 'resolved'::text, 'closed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_subtype_check' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_subtype_check CHECK (((subtype IS NULL) OR (subtype = ANY (ARRAY['post'::text, 'comment'::text, 'profile'::text, 'dm'::text, 'incident'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_subtype_shape' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_subtype_shape CHECK (((type = 'report'::text) = (subtype IS NOT NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_suggestion_tag_check' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_suggestion_tag_check CHECK (((suggestion_tag IS NULL) OR (suggestion_tag = ANY (ARRAY['planned'::text, 'maybe'::text, 'declined'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_target_type_check' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_target_type_check CHECK (((target_type IS NULL) OR (target_type = ANY (ARRAY['post'::text, 'comment'::text, 'profile'::text, 'conversation'::text, 'message'::text]))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_type_check' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_type_check CHECK ((type = ANY (ARRAY['help'::text, 'report'::text, 'suggestion'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_media_presets_name_check' AND conrelid = 'public.user_media_presets'::regclass) THEN
    ALTER TABLE public.user_media_presets ADD CONSTRAINT user_media_presets_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 40)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_mutes_not_self' AND conrelid = 'public.user_mutes'::regclass) THEN
    ALTER TABLE public.user_mutes ADD CONSTRAINT user_mutes_not_self CHECK ((muter_id <> muted_id));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_golf_link_check' AND conrelid = 'public.venues'::regclass) THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_golf_link_check CHECK ((num_nonnulls(golf_club_id, golf_course_id) <= 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_user_type_check' AND conrelid = 'public.waitlist'::regclass) THEN
    ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_user_type_check CHECK ((user_type = ANY (ARRAY['club'::text, 'league'::text, 'fan'::text, 'guest'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_category_check' AND conrelid = 'public.workout_exercises'::regclass) THEN
    ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_category_check CHECK ((category = ANY (ARRAY['strength'::text, 'cardio'::text, 'mobility'::text, 'other'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_name_check' AND conrelid = 'public.workout_exercises'::regclass) THEN
    ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_notes_check' AND conrelid = 'public.workout_exercises'::regclass) THEN
    ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_notes_check CHECK ((char_length(notes) <= 500));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routine_exercises_category_check' AND conrelid = 'public.workout_routine_exercises'::regclass) THEN
    ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_category_check CHECK ((category = ANY (ARRAY['strength'::text, 'cardio'::text, 'mobility'::text, 'other'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routine_exercises_name_check' AND conrelid = 'public.workout_routine_exercises'::regclass) THEN
    ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routine_exercises_notes_check' AND conrelid = 'public.workout_routine_exercises'::regclass) THEN
    ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_notes_check CHECK ((char_length(notes) <= 500));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routine_exercises_target_sets_check' AND conrelid = 'public.workout_routine_exercises'::regclass) THEN
    ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_target_sets_check CHECK (((target_sets >= 1) AND (target_sets <= 10)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routines_name_check' AND conrelid = 'public.workout_routines'::regclass) THEN
    ALTER TABLE public.workout_routines ADD CONSTRAINT workout_routines_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_duration_seconds_check' AND conrelid = 'public.workout_sessions'::regclass) THEN
    ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_duration_seconds_check CHECK ((duration_seconds >= 0));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_notes_check' AND conrelid = 'public.workout_sessions'::regclass) THEN
    ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_notes_check CHECK ((char_length(notes) <= 1000));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_source_check' AND conrelid = 'public.workout_sessions'::regclass) THEN
    ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_source_check CHECK ((source = ANY (ARRAY['live'::text, 'manual'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_status_check' AND conrelid = 'public.workout_sessions'::regclass) THEN
    ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_title_check' AND conrelid = 'public.workout_sessions'::regclass) THEN
    ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_title_check CHECK ((char_length(title) <= 120));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_distance_check' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_distance_check CHECK ((distance >= (0)::numeric));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_distance_unit_check' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_distance_unit_check CHECK ((distance_unit = ANY (ARRAY['mi'::text, 'km'::text, 'm'::text, 'yd'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_duration_seconds_check' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_duration_seconds_check CHECK ((duration_seconds >= 0));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_reps_check' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_reps_check CHECK (((reps >= 0) AND (reps <= 1000)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_set_number_check' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_set_number_check CHECK (((set_number >= 1) AND (set_number <= 99)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_weight_check' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_weight_check CHECK (((weight >= (0)::numeric) AND (weight <= (5000)::numeric)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_weight_unit_check' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_weight_unit_check CHECK ((weight_unit = ANY (ARRAY['lbs'::text, 'kg'::text])));
  END IF;
END $$;

-- ── Foreign keys ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_decided_by_profile_id_fkey' AND conrelid = 'public.affiliations'::regclass) THEN
    ALTER TABLE public.affiliations ADD CONSTRAINT affiliations_decided_by_profile_id_fkey FOREIGN KEY (decided_by_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_org_id_fkey' AND conrelid = 'public.affiliations'::regclass) THEN
    ALTER TABLE public.affiliations ADD CONSTRAINT affiliations_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_parent_org_id_fkey' AND conrelid = 'public.affiliations'::regclass) THEN
    ALTER TABLE public.affiliations ADD CONSTRAINT affiliations_parent_org_id_fkey FOREIGN KEY (parent_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_requested_by_profile_id_fkey' AND conrelid = 'public.affiliations'::regclass) THEN
    ALTER TABLE public.affiliations ADD CONSTRAINT affiliations_requested_by_profile_id_fkey FOREIGN KEY (requested_by_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_contacts_child_profile_id_fkey' AND conrelid = 'public.approved_contacts'::regclass) THEN
    ALTER TABLE public.approved_contacts ADD CONSTRAINT approved_contacts_child_profile_id_fkey FOREIGN KEY (child_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_contacts_contact_profile_id_fkey' AND conrelid = 'public.approved_contacts'::regclass) THEN
    ALTER TABLE public.approved_contacts ADD CONSTRAINT approved_contacts_contact_profile_id_fkey FOREIGN KEY (contact_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_contacts_decided_by_fkey' AND conrelid = 'public.approved_contacts'::regclass) THEN
    ALTER TABLE public.approved_contacts ADD CONSTRAINT approved_contacts_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_achievements_profile_id_fkey' AND conrelid = 'public.athlete_achievements'::regclass) THEN
    ALTER TABLE public.athlete_achievements ADD CONSTRAINT athlete_achievements_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_claim_invites_consumed_by_fkey' AND conrelid = 'public.athlete_claim_invites'::regclass) THEN
    ALTER TABLE public.athlete_claim_invites ADD CONSTRAINT athlete_claim_invites_consumed_by_fkey FOREIGN KEY (consumed_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_claim_invites_created_by_fkey' AND conrelid = 'public.athlete_claim_invites'::regclass) THEN
    ALTER TABLE public.athlete_claim_invites ADD CONSTRAINT athlete_claim_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_claim_invites_org_id_fkey' AND conrelid = 'public.athlete_claim_invites'::regclass) THEN
    ALTER TABLE public.athlete_claim_invites ADD CONSTRAINT athlete_claim_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_claim_invites_profile_id_fkey' AND conrelid = 'public.athlete_claim_invites'::regclass) THEN
    ALTER TABLE public.athlete_claim_invites ADD CONSTRAINT athlete_claim_invites_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_claim_invites_team_id_fkey' AND conrelid = 'public.athlete_claim_invites'::regclass) THEN
    ALTER TABLE public.athlete_claim_invites ADD CONSTRAINT athlete_claim_invites_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_equipment_profile_id_fkey' AND conrelid = 'public.athlete_equipment'::regclass) THEN
    ALTER TABLE public.athlete_equipment ADD CONSTRAINT athlete_equipment_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_performances_contest_id_fkey' AND conrelid = 'public.athlete_performances'::regclass) THEN
    ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_performances_entered_by_fkey' AND conrelid = 'public.athlete_performances'::regclass) THEN
    ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_performances_profile_id_fkey' AND conrelid = 'public.athlete_performances'::regclass) THEN
    ALTER TABLE public.athlete_performances ADD CONSTRAINT athlete_performances_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_vitals_linked_post_id_fkey' AND conrelid = 'public.athlete_vitals'::regclass) THEN
    ALTER TABLE public.athlete_vitals ADD CONSTRAINT athlete_vitals_linked_post_id_fkey FOREIGN KEY (linked_post_id) REFERENCES posts(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_vitals_profile_id_fkey' AND conrelid = 'public.athlete_vitals'::regclass) THEN
    ALTER TABLE public.athlete_vitals ADD CONSTRAINT athlete_vitals_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_feed_tokens_profile_id_fkey' AND conrelid = 'public.calendar_feed_tokens'::regclass) THEN
    ALTER TABLE public.calendar_feed_tokens ADD CONSTRAINT calendar_feed_tokens_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_comment_id_fkey' AND conrelid = 'public.comment_likes'::regclass) THEN
    ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_profile_id_fkey' AND conrelid = 'public.comment_likes'::regclass) THEN
    ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_affiliation_team_id_fkey' AND conrelid = 'public.competition_entries'::regclass) THEN
    ALTER TABLE public.competition_entries ADD CONSTRAINT competition_entries_affiliation_team_id_fkey FOREIGN KEY (affiliation_team_id) REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_competition_id_fkey' AND conrelid = 'public.competition_entries'::regclass) THEN
    ALTER TABLE public.competition_entries ADD CONSTRAINT competition_entries_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_profile_id_fkey' AND conrelid = 'public.competition_entries'::regclass) THEN
    ALTER TABLE public.competition_entries ADD CONSTRAINT competition_entries_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_team_id_fkey' AND conrelid = 'public.competition_entries'::regclass) THEN
    ALTER TABLE public.competition_entries ADD CONSTRAINT competition_entries_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entry_members_entry_id_fkey' AND conrelid = 'public.competition_entry_members'::regclass) THEN
    ALTER TABLE public.competition_entry_members ADD CONSTRAINT competition_entry_members_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES competition_entries(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entry_members_profile_id_fkey' AND conrelid = 'public.competition_entry_members'::regclass) THEN
    ALTER TABLE public.competition_entry_members ADD CONSTRAINT competition_entry_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_standings_competition_id_fkey' AND conrelid = 'public.competition_standings'::regclass) THEN
    ALTER TABLE public.competition_standings ADD CONSTRAINT competition_standings_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_standings_entry_id_fkey' AND conrelid = 'public.competition_standings'::regclass) THEN
    ALTER TABLE public.competition_standings ADD CONSTRAINT competition_standings_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES competition_entries(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_division_id_fkey' AND conrelid = 'public.competitions'::regclass) THEN
    ALTER TABLE public.competitions ADD CONSTRAINT competitions_division_id_fkey FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_org_id_fkey' AND conrelid = 'public.competitions'::regclass) THEN
    ALTER TABLE public.competitions ADD CONSTRAINT competitions_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_season_id_fkey' AND conrelid = 'public.competitions'::regclass) THEN
    ALTER TABLE public.competitions ADD CONSTRAINT competitions_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connection_suggestions_profile_id_fkey' AND conrelid = 'public.connection_suggestions'::regclass) THEN
    ALTER TABLE public.connection_suggestions ADD CONSTRAINT connection_suggestions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connection_suggestions_suggested_profile_id_fkey' AND conrelid = 'public.connection_suggestions'::regclass) THEN
    ALTER TABLE public.connection_suggestions ADD CONSTRAINT connection_suggestions_suggested_profile_id_fkey FOREIGN KEY (suggested_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_guardian_user_id_fkey' AND conrelid = 'public.consent_records'::regclass) THEN
    ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_guardian_user_id_fkey FOREIGN KEY (guardian_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_profile_id_fkey' AND conrelid = 'public.consent_records'::regclass) THEN
    ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_contest_id_fkey' AND conrelid = 'public.contest_media'::regclass) THEN
    ALTER TABLE public.contest_media ADD CONSTRAINT contest_media_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_uploaded_by_fkey' AND conrelid = 'public.contest_media'::regclass) THEN
    ALTER TABLE public.contest_media ADD CONSTRAINT contest_media_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_tags_media_id_fkey' AND conrelid = 'public.contest_media_tags'::regclass) THEN
    ALTER TABLE public.contest_media_tags ADD CONSTRAINT contest_media_tags_media_id_fkey FOREIGN KEY (media_id) REFERENCES contest_media(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_tags_profile_id_fkey' AND conrelid = 'public.contest_media_tags'::regclass) THEN
    ALTER TABLE public.contest_media_tags ADD CONSTRAINT contest_media_tags_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_media_tags_tagged_by_fkey' AND conrelid = 'public.contest_media_tags'::regclass) THEN
    ALTER TABLE public.contest_media_tags ADD CONSTRAINT contest_media_tags_tagged_by_fkey FOREIGN KEY (tagged_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_participants_contest_id_fkey' AND conrelid = 'public.contest_participants'::regclass) THEN
    ALTER TABLE public.contest_participants ADD CONSTRAINT contest_participants_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_participants_entry_id_fkey' AND conrelid = 'public.contest_participants'::regclass) THEN
    ALTER TABLE public.contest_participants ADD CONSTRAINT contest_participants_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES competition_entries(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_confirmed_by_fkey' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_contest_id_fkey' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_disputed_by_fkey' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_disputed_by_fkey FOREIGN KEY (disputed_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_entered_by_fkey' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_participant_id_fkey' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES contest_participants(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_resolved_by_fkey' AND conrelid = 'public.contest_results'::regclass) THEN
    ALTER TABLE public.contest_results ADD CONSTRAINT contest_results_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_stat_lines_contest_id_fkey' AND conrelid = 'public.contest_stat_lines'::regclass) THEN
    ALTER TABLE public.contest_stat_lines ADD CONSTRAINT contest_stat_lines_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_stat_lines_entered_by_fkey' AND conrelid = 'public.contest_stat_lines'::regclass) THEN
    ALTER TABLE public.contest_stat_lines ADD CONSTRAINT contest_stat_lines_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_stat_lines_profile_id_fkey' AND conrelid = 'public.contest_stat_lines'::regclass) THEN
    ALTER TABLE public.contest_stat_lines ADD CONSTRAINT contest_stat_lines_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_stat_lines_team_id_fkey' AND conrelid = 'public.contest_stat_lines'::regclass) THEN
    ALTER TABLE public.contest_stat_lines ADD CONSTRAINT contest_stat_lines_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_competition_id_fkey' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_event_id_fkey' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_facility_id_fkey' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_facility_venue_fk' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_facility_venue_fk FOREIGN KEY (facility_id, venue_id) REFERENCES facilities(id, venue_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_sport_event_match_id_fkey' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_sport_event_match_id_fkey FOREIGN KEY (sport_event_match_id) REFERENCES sport_event_matches(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_sport_event_round_id_fkey' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_sport_event_round_id_fkey FOREIGN KEY (sport_event_round_id) REFERENCES sport_event_rounds(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_venue_id_fkey' AND conrelid = 'public.contests'::regclass) THEN
    ALTER TABLE public.contests ADD CONSTRAINT contests_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_conversation_id_fkey' AND conrelid = 'public.conversation_participants'::regclass) THEN
    ALTER TABLE public.conversation_participants ADD CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_profile_id_fkey' AND conrelid = 'public.conversation_participants'::regclass) THEN
    ALTER TABLE public.conversation_participants ADD CONSTRAINT conversation_participants_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_created_by_fkey' AND conrelid = 'public.conversations'::regclass) THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_frozen_ticket_id_fkey' AND conrelid = 'public.conversations'::regclass) THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_frozen_ticket_id_fkey FOREIGN KEY (frozen_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'divisions_org_id_fkey' AND conrelid = 'public.divisions'::regclass) THEN
    ALTER TABLE public.divisions ADD CONSTRAINT divisions_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'divisions_season_id_fkey' AND conrelid = 'public.divisions'::regclass) THEN
    ALTER TABLE public.divisions ADD CONSTRAINT divisions_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_claims_offer_id_fkey' AND conrelid = 'public.event_carpool_claims'::regclass) THEN
    ALTER TABLE public.event_carpool_claims ADD CONSTRAINT event_carpool_claims_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES event_carpool_offers(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_claims_rider_profile_id_fkey' AND conrelid = 'public.event_carpool_claims'::regclass) THEN
    ALTER TABLE public.event_carpool_claims ADD CONSTRAINT event_carpool_claims_rider_profile_id_fkey FOREIGN KEY (rider_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_offers_driver_profile_id_fkey' AND conrelid = 'public.event_carpool_offers'::regclass) THEN
    ALTER TABLE public.event_carpool_offers ADD CONSTRAINT event_carpool_offers_driver_profile_id_fkey FOREIGN KEY (driver_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_carpool_offers_event_id_fkey' AND conrelid = 'public.event_carpool_offers'::regclass) THEN
    ALTER TABLE public.event_carpool_offers ADD CONSTRAINT event_carpool_offers_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_guests_event_id_fkey' AND conrelid = 'public.event_guests'::regclass) THEN
    ALTER TABLE public.event_guests ADD CONSTRAINT event_guests_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_guests_profile_id_fkey' AND conrelid = 'public.event_guests'::regclass) THEN
    ALTER TABLE public.event_guests ADD CONSTRAINT event_guests_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_organizer_id_fkey' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_division_id_fkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_division_id_fkey FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_facility_id_fkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_facility_venue_fk' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_facility_venue_fk FOREIGN KEY (facility_id, venue_id) REFERENCES facilities(id, venue_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_org_id_fkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_organizer_id_fkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_routine_id_fkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_routine_id_fkey FOREIGN KEY (routine_id) REFERENCES workout_routines(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_series_id_fkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_series_id_fkey FOREIGN KEY (series_id) REFERENCES event_series(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_team_id_fkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_venue_id_fkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facilities_venue_id_fkey' AND conrelid = 'public.facilities'::regclass) THEN
    ALTER TABLE public.facilities ADD CONSTRAINT facilities_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_follower_id_fkey' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_following_id_fkey' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_clubs_place_id_fkey' AND conrelid = 'public.golf_clubs'::regclass) THEN
    ALTER TABLE public.golf_clubs ADD CONSTRAINT golf_clubs_place_id_fkey FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_courses_club_id_fkey' AND conrelid = 'public.golf_courses'::regclass) THEN
    ALTER TABLE public.golf_courses ADD CONSTRAINT golf_courses_club_id_fkey FOREIGN KEY (club_id) REFERENCES golf_clubs(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_courses_place_id_fkey' AND conrelid = 'public.golf_courses'::regclass) THEN
    ALTER TABLE public.golf_courses ADD CONSTRAINT golf_courses_place_id_fkey FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_hole_scores_golf_participant_id_fkey' AND conrelid = 'public.golf_hole_scores'::regclass) THEN
    ALTER TABLE public.golf_hole_scores ADD CONSTRAINT golf_hole_scores_golf_participant_id_fkey FOREIGN KEY (golf_participant_id) REFERENCES golf_participant_scores(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_holes_round_id_fkey' AND conrelid = 'public.golf_holes'::regclass) THEN
    ALTER TABLE public.golf_holes ADD CONSTRAINT golf_holes_round_id_fkey FOREIGN KEY (round_id) REFERENCES golf_rounds(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_participant_scores_entered_by_fkey' AND conrelid = 'public.golf_participant_scores'::regclass) THEN
    ALTER TABLE public.golf_participant_scores ADD CONSTRAINT golf_participant_scores_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_participant_scores_finalized_by_fkey' AND conrelid = 'public.golf_participant_scores'::regclass) THEN
    ALTER TABLE public.golf_participant_scores ADD CONSTRAINT golf_participant_scores_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_participant_scores_participant_id_fkey' AND conrelid = 'public.golf_participant_scores'::regclass) THEN
    ALTER TABLE public.golf_participant_scores ADD CONSTRAINT golf_participant_scores_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES group_post_participants(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_course_id_fkey' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_course_id_fkey FOREIGN KEY (course_id) REFERENCES golf_courses(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_group_post_id_fkey' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_group_post_id_fkey FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_profile_id_fkey' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_course_id_fkey' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_course_id_fkey FOREIGN KEY (course_id) REFERENCES golf_courses(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_group_post_id_fkey' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_group_post_id_fkey FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_media_group_post_id_fkey' AND conrelid = 'public.group_post_media'::regclass) THEN
    ALTER TABLE public.group_post_media ADD CONSTRAINT group_post_media_group_post_id_fkey FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_media_uploaded_by_fkey' AND conrelid = 'public.group_post_media'::regclass) THEN
    ALTER TABLE public.group_post_media ADD CONSTRAINT group_post_media_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_participants_group_post_id_fkey' AND conrelid = 'public.group_post_participants'::regclass) THEN
    ALTER TABLE public.group_post_participants ADD CONSTRAINT group_post_participants_group_post_id_fkey FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_post_participants_profile_id_fkey' AND conrelid = 'public.group_post_participants'::regclass) THEN
    ALTER TABLE public.group_post_participants ADD CONSTRAINT group_post_participants_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_posts_contest_id_fkey' AND conrelid = 'public.group_posts'::regclass) THEN
    ALTER TABLE public.group_posts ADD CONSTRAINT group_posts_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_posts_creator_id_fkey' AND conrelid = 'public.group_posts'::regclass) THEN
    ALTER TABLE public.group_posts ADD CONSTRAINT group_posts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_posts_post_id_fkey' AND conrelid = 'public.group_posts'::regclass) THEN
    ALTER TABLE public.group_posts ADD CONSTRAINT group_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_posts_sport_event_round_id_fkey' AND conrelid = 'public.group_posts'::regclass) THEN
    ALTER TABLE public.group_posts ADD CONSTRAINT group_posts_sport_event_round_id_fkey FOREIGN KEY (sport_event_round_id) REFERENCES sport_event_rounds(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardian_invites_created_by_fkey' AND conrelid = 'public.guardian_invites'::regclass) THEN
    ALTER TABLE public.guardian_invites ADD CONSTRAINT guardian_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardian_invites_pending_profile_id_fkey' AND conrelid = 'public.guardian_invites'::regclass) THEN
    ALTER TABLE public.guardian_invites ADD CONSTRAINT guardian_invites_pending_profile_id_fkey FOREIGN KEY (pending_profile_id) REFERENCES pending_profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardian_invites_profile_id_fkey' AND conrelid = 'public.guardian_invites'::regclass) THEN
    ALTER TABLE public.guardian_invites ADD CONSTRAINT guardian_invites_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handle_history_profile_id_fkey' AND conrelid = 'public.handle_history'::regclass) THEN
    ALTER TABLE public.handle_history ADD CONSTRAINT handle_history_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'help_articles_created_by_fkey' AND conrelid = 'public.help_articles'::regclass) THEN
    ALTER TABLE public.help_articles ADD CONSTRAINT help_articles_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'help_articles_updated_by_fkey' AND conrelid = 'public.help_articles'::regclass) THEN
    ALTER TABLE public.help_articles ADD CONSTRAINT help_articles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_granted_by_fkey' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_org_id_fkey' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_photo_consent_by_fkey' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_photo_consent_by_fkey FOREIGN KEY (photo_consent_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_profile_id_fkey' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_season_fk' AND conrelid = 'public.memberships'::regclass) THEN
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_season_fk FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_message_id_fkey' AND conrelid = 'public.message_reactions'::regclass) THEN
    ALTER TABLE public.message_reactions ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_profile_id_fkey' AND conrelid = 'public.message_reactions'::regclass) THEN
    ALTER TABLE public.message_reactions ADD CONSTRAINT message_reactions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reports_conversation_id_fkey' AND conrelid = 'public.message_reports'::regclass) THEN
    ALTER TABLE public.message_reports ADD CONSTRAINT message_reports_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reports_message_id_fkey' AND conrelid = 'public.message_reports'::regclass) THEN
    ALTER TABLE public.message_reports ADD CONSTRAINT message_reports_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reports_reported_profile_id_fkey' AND conrelid = 'public.message_reports'::regclass) THEN
    ALTER TABLE public.message_reports ADD CONSTRAINT message_reports_reported_profile_id_fkey FOREIGN KEY (reported_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reports_reporter_id_fkey' AND conrelid = 'public.message_reports'::regclass) THEN
    ALTER TABLE public.message_reports ADD CONSTRAINT message_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversation_id_fkey' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_parent_message_id_fkey' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_sender_id_fkey' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_shared_post_id_fkey' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_shared_post_id_fkey FOREIGN KEY (shared_post_id) REFERENCES posts(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_shared_profile_id_fkey' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_shared_profile_id_fkey FOREIGN KEY (shared_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_user_id_fkey' AND conrelid = 'public.notification_preferences'::regclass) THEN
    ALTER TABLE public.notification_preferences ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_actor_id_fkey' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_follow_id_fkey' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_follow_id_fkey FOREIGN KEY (follow_id) REFERENCES follows(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_grouped_notification_id_fkey' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_grouped_notification_id_fkey FOREIGN KEY (grouped_notification_id) REFERENCES notifications(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_post_id_fkey' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_fkey' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_claim_invites_consumed_by_fkey' AND conrelid = 'public.org_claim_invites'::regclass) THEN
    ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_consumed_by_fkey FOREIGN KEY (consumed_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_claim_invites_created_by_fkey' AND conrelid = 'public.org_claim_invites'::regclass) THEN
    ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_claim_invites_org_id_fkey' AND conrelid = 'public.org_claim_invites'::regclass) THEN
    ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_join_requests_org_id_fkey' AND conrelid = 'public.org_join_requests'::regclass) THEN
    ALTER TABLE public.org_join_requests ADD CONSTRAINT org_join_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_join_requests_profile_id_fkey' AND conrelid = 'public.org_join_requests'::regclass) THEN
    ALTER TABLE public.org_join_requests ADD CONSTRAINT org_join_requests_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_requests_created_org_id_fkey' AND conrelid = 'public.org_requests'::regclass) THEN
    ALTER TABLE public.org_requests ADD CONSTRAINT org_requests_created_org_id_fkey FOREIGN KEY (created_org_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_requests_place_id_fkey' AND conrelid = 'public.org_requests'::regclass) THEN
    ALTER TABLE public.org_requests ADD CONSTRAINT org_requests_place_id_fkey FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_requests_requester_profile_id_fkey' AND conrelid = 'public.org_requests'::regclass) THEN
    ALTER TABLE public.org_requests ADD CONSTRAINT org_requests_requester_profile_id_fkey FOREIGN KEY (requester_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_requests_reviewed_by_fkey' AND conrelid = 'public.org_requests'::regclass) THEN
    ALTER TABLE public.org_requests ADD CONSTRAINT org_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_form_submissions_site_id_fkey' AND conrelid = 'public.org_site_form_submissions'::regclass) THEN
    ALTER TABLE public.org_site_form_submissions ADD CONSTRAINT org_site_form_submissions_site_id_fkey FOREIGN KEY (site_id) REFERENCES org_sites(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_hit_marks_site_id_fkey' AND conrelid = 'public.org_site_hit_marks'::regclass) THEN
    ALTER TABLE public.org_site_hit_marks ADD CONSTRAINT org_site_hit_marks_site_id_fkey FOREIGN KEY (site_id) REFERENCES org_sites(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_modules_site_id_fkey' AND conrelid = 'public.org_site_modules'::regclass) THEN
    ALTER TABLE public.org_site_modules ADD CONSTRAINT org_site_modules_site_id_fkey FOREIGN KEY (site_id) REFERENCES org_sites(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_news_site_id_fkey' AND conrelid = 'public.org_site_news'::regclass) THEN
    ALTER TABLE public.org_site_news ADD CONSTRAINT org_site_news_site_id_fkey FOREIGN KEY (site_id) REFERENCES org_sites(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_pages_site_id_fkey' AND conrelid = 'public.org_site_pages'::regclass) THEN
    ALTER TABLE public.org_site_pages ADD CONSTRAINT org_site_pages_site_id_fkey FOREIGN KEY (site_id) REFERENCES org_sites(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_revisions_created_by_fkey' AND conrelid = 'public.org_site_revisions'::regclass) THEN
    ALTER TABLE public.org_site_revisions ADD CONSTRAINT org_site_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_revisions_published_by_fkey' AND conrelid = 'public.org_site_revisions'::regclass) THEN
    ALTER TABLE public.org_site_revisions ADD CONSTRAINT org_site_revisions_published_by_fkey FOREIGN KEY (published_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_revisions_site_id_fkey' AND conrelid = 'public.org_site_revisions'::regclass) THEN
    ALTER TABLE public.org_site_revisions ADD CONSTRAINT org_site_revisions_site_id_fkey FOREIGN KEY (site_id) REFERENCES org_sites(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_site_stats_daily_site_id_fkey' AND conrelid = 'public.org_site_stats_daily'::regclass) THEN
    ALTER TABLE public.org_site_stats_daily ADD CONSTRAINT org_site_stats_daily_site_id_fkey FOREIGN KEY (site_id) REFERENCES org_sites(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_draft_revision_id_fkey' AND conrelid = 'public.org_sites'::regclass) THEN
    ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_draft_revision_id_fkey FOREIGN KEY (draft_revision_id) REFERENCES org_site_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_org_id_fkey' AND conrelid = 'public.org_sites'::regclass) THEN
    ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_published_revision_id_fkey' AND conrelid = 'public.org_sites'::regclass) THEN
    ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_published_revision_id_fkey FOREIGN KEY (published_revision_id) REFERENCES org_site_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_consumed_by_fkey' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_consumed_by_fkey FOREIGN KEY (consumed_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_created_by_fkey' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_org_id_fkey' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_invites_season_id_fkey' AND conrelid = 'public.org_staff_invites'::regclass) THEN
    ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_owner_profile_id_fkey' AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_place_id_fkey' AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_place_id_fkey FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_profiles_promoted_profile_id_fkey' AND conrelid = 'public.pending_profiles'::regclass) THEN
    ALTER TABLE public.pending_profiles ADD CONSTRAINT pending_profiles_promoted_profile_id_fkey FOREIGN KEY (promoted_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performances_profile_id_fkey' AND conrelid = 'public.performances'::regclass) THEN
    ALTER TABLE public.performances ADD CONSTRAINT performances_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_aliases_geonames_id_fkey' AND conrelid = 'public.place_aliases'::regclass) THEN
    ALTER TABLE public.place_aliases ADD CONSTRAINT place_aliases_geonames_id_fkey FOREIGN KEY (geonames_id) REFERENCES places(geonames_id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_admins_granted_by_fkey' AND conrelid = 'public.platform_admins'::regclass) THEN
    ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_admins_profile_id_fkey' AND conrelid = 'public.platform_admins'::regclass) THEN
    ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_created_by_user_id_fkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_hidden_ticket_id_fkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_hidden_ticket_id_fkey FOREIGN KEY (hidden_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_parent_comment_id_fkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES post_comments(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_post_id_fkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_profile_id_fkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_post_id_fkey' AND conrelid = 'public.post_likes'::regclass) THEN
    ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_profile_id_fkey' AND conrelid = 'public.post_likes'::regclass) THEN
    ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_media_post_id_fkey' AND conrelid = 'public.post_media'::regclass) THEN
    ALTER TABLE public.post_media ADD CONSTRAINT post_media_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_tags_created_by_profile_id_fkey' AND conrelid = 'public.post_tags'::regclass) THEN
    ALTER TABLE public.post_tags ADD CONSTRAINT post_tags_created_by_profile_id_fkey FOREIGN KEY (created_by_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_tags_media_id_fkey' AND conrelid = 'public.post_tags'::regclass) THEN
    ALTER TABLE public.post_tags ADD CONSTRAINT post_tags_media_id_fkey FOREIGN KEY (media_id) REFERENCES post_media(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_tags_post_id_fkey' AND conrelid = 'public.post_tags'::regclass) THEN
    ALTER TABLE public.post_tags ADD CONSTRAINT post_tags_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_tags_tagged_profile_id_fkey' AND conrelid = 'public.post_tags'::regclass) THEN
    ALTER TABLE public.post_tags ADD CONSTRAINT post_tags_tagged_profile_id_fkey FOREIGN KEY (tagged_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_contest_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_created_by_user_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_event_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_group_post_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_group_post_id_fkey FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_hidden_ticket_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_hidden_ticket_id_fkey FOREIGN KEY (hidden_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_profile_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_round_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_round_id_fkey FOREIGN KEY (round_id) REFERENCES golf_rounds(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_shared_post_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_shared_post_id_fkey FOREIGN KEY (shared_post_id) REFERENCES posts(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_sport_event_round_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_sport_event_round_id_fkey FOREIGN KEY (sport_event_round_id) REFERENCES sport_event_rounds(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_settings_profile_id_fkey' AND conrelid = 'public.privacy_settings'::regclass) THEN
    ALTER TABLE public.privacy_settings ADD CONSTRAINT privacy_settings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_access_granted_by_fkey' AND conrelid = 'public.profile_access'::regclass) THEN
    ALTER TABLE public.profile_access ADD CONSTRAINT profile_access_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_access_profile_id_fkey' AND conrelid = 'public.profile_access'::regclass) THEN
    ALTER TABLE public.profile_access ADD CONSTRAINT profile_access_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_access_user_id_fkey' AND conrelid = 'public.profile_access'::regclass) THEN
    ALTER TABLE public.profile_access ADD CONSTRAINT profile_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_transfers_initiator_user_id_fkey' AND conrelid = 'public.profile_transfers'::regclass) THEN
    ALTER TABLE public.profile_transfers ADD CONSTRAINT profile_transfers_initiator_user_id_fkey FOREIGN KEY (initiator_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_transfers_profile_id_fkey' AND conrelid = 'public.profile_transfers'::regclass) THEN
    ALTER TABLE public.profile_transfers ADD CONSTRAINT profile_transfers_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_moderation_ticket_id_fkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_moderation_ticket_id_fkey FOREIGN KEY (moderation_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_place_id_fkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_place_id_fkey FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_season_id_fkey' AND conrelid = 'public.programs'::regclass) THEN
    ALTER TABLE public.programs ADD CONSTRAINT programs_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_windows_created_by_fkey' AND conrelid = 'public.registration_windows'::regclass) THEN
    ALTER TABLE public.registration_windows ADD CONSTRAINT registration_windows_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_windows_division_id_fkey' AND conrelid = 'public.registration_windows'::regclass) THEN
    ALTER TABLE public.registration_windows ADD CONSTRAINT registration_windows_division_id_fkey FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_windows_org_id_fkey' AND conrelid = 'public.registration_windows'::regclass) THEN
    ALTER TABLE public.registration_windows ADD CONSTRAINT registration_windows_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_windows_program_id_fkey' AND conrelid = 'public.registration_windows'::regclass) THEN
    ALTER TABLE public.registration_windows ADD CONSTRAINT registration_windows_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_windows_season_id_fkey' AND conrelid = 'public.registration_windows'::regclass) THEN
    ALTER TABLE public.registration_windows ADD CONSTRAINT registration_windows_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_division_id_fkey' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_division_id_fkey FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_org_id_fkey' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_profile_id_fkey' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_program_id_fkey' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_released_by_fkey' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_released_by_fkey FOREIGN KEY (released_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_season_id_fkey' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_submitted_by_fkey' AND conrelid = 'public.registrations'::regclass) THEN
    ALTER TABLE public.registrations ADD CONSTRAINT registrations_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_signals_profile_id_fkey' AND conrelid = 'public.risk_signals'::regclass) THEN
    ALTER TABLE public.risk_signals ADD CONSTRAINT risk_signals_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sanction_grants_grantee_org_id_fkey' AND conrelid = 'public.sanction_grants'::regclass) THEN
    ALTER TABLE public.sanction_grants ADD CONSTRAINT sanction_grants_grantee_org_id_fkey FOREIGN KEY (grantee_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sanction_grants_grantor_org_id_fkey' AND conrelid = 'public.sanction_grants'::regclass) THEN
    ALTER TABLE public.sanction_grants ADD CONSTRAINT sanction_grants_grantor_org_id_fkey FOREIGN KEY (grantor_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_posts_post_id_fkey' AND conrelid = 'public.saved_posts'::regclass) THEN
    ALTER TABLE public.saved_posts ADD CONSTRAINT saved_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_posts_profile_id_fkey' AND conrelid = 'public.saved_posts'::regclass) THEN
    ALTER TABLE public.saved_posts ADD CONSTRAINT saved_posts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scout_shortlists_athlete_id_fkey' AND conrelid = 'public.scout_shortlists'::regclass) THEN
    ALTER TABLE public.scout_shortlists ADD CONSTRAINT scout_shortlists_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scout_shortlists_scout_id_fkey' AND conrelid = 'public.scout_shortlists'::regclass) THEN
    ALTER TABLE public.scout_shortlists ADD CONSTRAINT scout_shortlists_scout_id_fkey FOREIGN KEY (scout_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'search_documents_place_id_fkey' AND conrelid = 'public.search_documents'::regclass) THEN
    ALTER TABLE public.search_documents ADD CONSTRAINT search_documents_place_id_fkey FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_highlights_profile_id_fkey' AND conrelid = 'public.season_highlights'::regclass) THEN
    ALTER TABLE public.season_highlights ADD CONSTRAINT season_highlights_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_org_id_fkey' AND conrelid = 'public.seasons'::regclass) THEN
    ALTER TABLE public.seasons ADD CONSTRAINT seasons_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_group_members_group_id_fkey' AND conrelid = 'public.sport_event_group_members'::regclass) THEN
    ALTER TABLE public.sport_event_group_members ADD CONSTRAINT sport_event_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES sport_event_groups(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_group_members_participant_id_fkey' AND conrelid = 'public.sport_event_group_members'::regclass) THEN
    ALTER TABLE public.sport_event_group_members ADD CONSTRAINT sport_event_group_members_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES sport_event_participants(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_group_members_sport_event_round_id_fkey' AND conrelid = 'public.sport_event_group_members'::regclass) THEN
    ALTER TABLE public.sport_event_group_members ADD CONSTRAINT sport_event_group_members_sport_event_round_id_fkey FOREIGN KEY (sport_event_round_id) REFERENCES sport_event_rounds(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_groups_sport_event_round_id_fkey' AND conrelid = 'public.sport_event_groups'::regclass) THEN
    ALTER TABLE public.sport_event_groups ADD CONSTRAINT sport_event_groups_sport_event_round_id_fkey FOREIGN KEY (sport_event_round_id) REFERENCES sport_event_rounds(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_group_id_fkey' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_group_id_fkey FOREIGN KEY (group_id) REFERENCES sport_event_groups(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_matches_sport_event_round_id_fkey' AND conrelid = 'public.sport_event_matches'::regclass) THEN
    ALTER TABLE public.sport_event_matches ADD CONSTRAINT sport_event_matches_sport_event_round_id_fkey FOREIGN KEY (sport_event_round_id) REFERENCES sport_event_rounds(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_media_created_by_user_id_fkey' AND conrelid = 'public.sport_event_media'::regclass) THEN
    ALTER TABLE public.sport_event_media ADD CONSTRAINT sport_event_media_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_media_sport_event_id_fkey' AND conrelid = 'public.sport_event_media'::regclass) THEN
    ALTER TABLE public.sport_event_media ADD CONSTRAINT sport_event_media_sport_event_id_fkey FOREIGN KEY (sport_event_id) REFERENCES sport_events(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_media_sport_event_round_id_fkey' AND conrelid = 'public.sport_event_media'::regclass) THEN
    ALTER TABLE public.sport_event_media ADD CONSTRAINT sport_event_media_sport_event_round_id_fkey FOREIGN KEY (sport_event_round_id) REFERENCES sport_event_rounds(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_media_uploaded_by_fkey' AND conrelid = 'public.sport_event_media'::regclass) THEN
    ALTER TABLE public.sport_event_media ADD CONSTRAINT sport_event_media_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_invited_by_fkey' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_profile_id_fkey' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_sport_event_id_fkey' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE public.sport_event_participants ADD CONSTRAINT sport_event_participants_sport_event_id_fkey FOREIGN KEY (sport_event_id) REFERENCES sport_events(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_course_id_fkey' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_course_id_fkey FOREIGN KEY (course_id) REFERENCES golf_courses(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_sport_event_id_fkey' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE public.sport_event_rounds ADD CONSTRAINT sport_event_rounds_sport_event_id_fkey FOREIGN KEY (sport_event_id) REFERENCES sport_events(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_stat_lines_entered_by_fkey' AND conrelid = 'public.sport_event_stat_lines'::regclass) THEN
    ALTER TABLE public.sport_event_stat_lines ADD CONSTRAINT sport_event_stat_lines_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_stat_lines_participant_id_fkey' AND conrelid = 'public.sport_event_stat_lines'::regclass) THEN
    ALTER TABLE public.sport_event_stat_lines ADD CONSTRAINT sport_event_stat_lines_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES sport_event_participants(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_stat_lines_profile_id_fkey' AND conrelid = 'public.sport_event_stat_lines'::regclass) THEN
    ALTER TABLE public.sport_event_stat_lines ADD CONSTRAINT sport_event_stat_lines_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_stat_lines_sport_event_round_id_fkey' AND conrelid = 'public.sport_event_stat_lines'::regclass) THEN
    ALTER TABLE public.sport_event_stat_lines ADD CONSTRAINT sport_event_stat_lines_sport_event_round_id_fkey FOREIGN KEY (sport_event_round_id) REFERENCES sport_event_rounds(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_competition_id_fkey' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_created_by_user_id_fkey' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_host_profile_id_fkey' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_host_profile_id_fkey FOREIGN KEY (host_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_org_id_fkey' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_settings_profile_id_fkey' AND conrelid = 'public.sport_settings'::regclass) THEN
    ALTER TABLE public.sport_settings ADD CONSTRAINT sport_settings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sports_profile_id_fkey' AND conrelid = 'public.sports'::regclass) THEN
    ALTER TABLE public.sports ADD CONSTRAINT sports_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_entries_division_id_fkey' AND conrelid = 'public.team_entries'::regclass) THEN
    ALTER TABLE public.team_entries ADD CONSTRAINT team_entries_division_id_fkey FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_entries_team_id_fkey' AND conrelid = 'public.team_entries'::regclass) THEN
    ALTER TABLE public.team_entries ADD CONSTRAINT team_entries_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_org_id_fkey' AND conrelid = 'public.teams'::regclass) THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_events_actor_profile_id_fkey' AND conrelid = 'public.ticket_events'::regclass) THEN
    ALTER TABLE public.ticket_events ADD CONSTRAINT ticket_events_actor_profile_id_fkey FOREIGN KEY (actor_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_events_ticket_id_fkey' AND conrelid = 'public.ticket_events'::regclass) THEN
    ALTER TABLE public.ticket_events ADD CONSTRAINT ticket_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_assignee_profile_id_fkey' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_assignee_profile_id_fkey FOREIGN KEY (assignee_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_merged_into_id_fkey' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES tickets(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_reporter_profile_id_fkey' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_reporter_profile_id_fkey FOREIGN KEY (reporter_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_target_profile_id_fkey' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_blocked_id_fkey' AND conrelid = 'public.user_blocks'::regclass) THEN
    ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_blocker_id_fkey' AND conrelid = 'public.user_blocks'::regclass) THEN
    ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_media_presets_profile_id_fkey' AND conrelid = 'public.user_media_presets'::regclass) THEN
    ALTER TABLE public.user_media_presets ADD CONSTRAINT user_media_presets_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_mutes_muted_id_fkey' AND conrelid = 'public.user_mutes'::regclass) THEN
    ALTER TABLE public.user_mutes ADD CONSTRAINT user_mutes_muted_id_fkey FOREIGN KEY (muted_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_mutes_muter_id_fkey' AND conrelid = 'public.user_mutes'::regclass) THEN
    ALTER TABLE public.user_mutes ADD CONSTRAINT user_mutes_muter_id_fkey FOREIGN KEY (muter_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_golf_club_id_fkey' AND conrelid = 'public.venues'::regclass) THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_golf_club_id_fkey FOREIGN KEY (golf_club_id) REFERENCES golf_clubs(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_golf_course_id_fkey' AND conrelid = 'public.venues'::regclass) THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_golf_course_id_fkey FOREIGN KEY (golf_course_id) REFERENCES golf_courses(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_org_id_fkey' AND conrelid = 'public.venues'::regclass) THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_place_id_fkey' AND conrelid = 'public.venues'::regclass) THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_place_id_fkey FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_profile_id_fkey' AND conrelid = 'public.workout_exercises'::regclass) THEN
    ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_session_id_fkey' AND conrelid = 'public.workout_exercises'::regclass) THEN
    ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_session_id_fkey FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routine_exercises_profile_id_fkey' AND conrelid = 'public.workout_routine_exercises'::regclass) THEN
    ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routine_exercises_routine_id_fkey' AND conrelid = 'public.workout_routine_exercises'::regclass) THEN
    ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_routine_id_fkey FOREIGN KEY (routine_id) REFERENCES workout_routines(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_routines_profile_id_fkey' AND conrelid = 'public.workout_routines'::regclass) THEN
    ALTER TABLE public.workout_routines ADD CONSTRAINT workout_routines_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_post_id_fkey' AND conrelid = 'public.workout_sessions'::regclass) THEN
    ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_profile_id_fkey' AND conrelid = 'public.workout_sessions'::regclass) THEN
    ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_exercise_id_fkey' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES workout_exercises(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sets_profile_id_fkey' AND conrelid = 'public.workout_sets'::regclass) THEN
    ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_affiliations_parent ON public.affiliations USING btree (parent_org_id);
CREATE INDEX IF NOT EXISTS idx_achievements_profile_date ON public.athlete_achievements USING btree (profile_id, achieved_on DESC);
CREATE INDEX IF NOT EXISTS idx_athlete_claim_invites_org ON public.athlete_claim_invites USING btree (org_id) WHERE (org_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_athlete_claim_invites_profile ON public.athlete_claim_invites USING btree (profile_id) WHERE (consumed_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON public.athlete_equipment USING btree (category);
CREATE INDEX IF NOT EXISTS idx_equipment_profile ON public.athlete_equipment USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_equipment_sport ON public.athlete_equipment USING btree (sport_key);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.athlete_equipment USING btree (status);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_headline ON public.athlete_performances USING btree (sport_key, headline) WHERE (headline IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_metrics ON public.athlete_performances USING gin (metrics jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_profile ON public.athlete_performances USING btree (profile_id, sport_key, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_source ON public.athlete_performances USING btree (source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_sport_date ON public.athlete_performances USING btree (sport_key, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_athlete_vitals_linked_post ON public.athlete_vitals USING btree (linked_post_id) WHERE (linked_post_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_athlete_vitals_profile_date ON public.athlete_vitals USING btree (profile_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_athlete_vitals_profile_id ON public.athlete_vitals USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_athlete_vitals_profile_metric ON public.athlete_vitals USING btree (profile_id, metric_key);
CREATE INDEX IF NOT EXISTS idx_calendar_feed_tokens_profile ON public.calendar_feed_tokens USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_profile ON public.comment_likes USING btree (profile_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS competition_entries_name_uniq ON public.competition_entries USING btree (competition_id, lower(name)) WHERE ((team_id IS NULL) AND (profile_id IS NULL) AND (name IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS competition_entries_profile_uniq ON public.competition_entries USING btree (competition_id, profile_id) WHERE (profile_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS competition_entries_source_ref_uniq ON public.competition_entries USING btree (competition_id, source_ref) WHERE (source_ref IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS competition_entries_team_uniq ON public.competition_entries USING btree (competition_id, team_id) WHERE (team_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_competition_entries_competition ON public.competition_entries USING btree (competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_entries_profile ON public.competition_entries USING btree (profile_id) WHERE (profile_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_competition_entries_seed ON public.competition_entries USING btree (competition_id, seed) WHERE (seed IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_competition_entries_team ON public.competition_entries USING btree (team_id) WHERE (team_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_competition_entry_members_profile ON public.competition_entry_members USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_competition_standings_rank ON public.competition_standings USING btree (competition_id, rank);
CREATE INDEX IF NOT EXISTS idx_competitions_division ON public.competitions USING btree (division_id) WHERE (division_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_competitions_org ON public.competitions USING btree (org_id);
CREATE INDEX IF NOT EXISTS idx_competitions_season ON public.competitions USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_connection_suggestions_dismissed ON public.connection_suggestions USING btree (profile_id, dismissed) WHERE (dismissed = true);
CREATE INDEX IF NOT EXISTS idx_connection_suggestions_profile ON public.connection_suggestions USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_connection_suggestions_suggested_profile_id ON public.connection_suggestions USING btree (suggested_profile_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_profile ON public.consent_records USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON public.contact_messages USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contest_media_contest ON public.contest_media USING btree (contest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contest_media_tags_media ON public.contest_media_tags USING btree (media_id);
CREATE INDEX IF NOT EXISTS idx_contest_media_tags_profile ON public.contest_media_tags USING btree (profile_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS contest_participants_side_uniq ON public.contest_participants USING btree (contest_id, side) WHERE (side IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_contest_participants_contest ON public.contest_participants USING btree (contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_participants_entry ON public.contest_participants USING btree (entry_id);
CREATE INDEX IF NOT EXISTS idx_contest_results_contest ON public.contest_results USING btree (contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_stat_lines_contest ON public.contest_stat_lines USING btree (contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_stat_lines_profile ON public.contest_stat_lines USING btree (profile_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS contests_sport_event_match_uniq ON public.contests USING btree (sport_event_match_id) WHERE (sport_event_match_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS contests_sport_event_round_uniq ON public.contests USING btree (sport_event_round_id) WHERE (sport_event_round_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS contests_stage_slot_uniq ON public.contests USING btree (competition_id, stage, slot) WHERE (stage IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_contests_competition ON public.contests USING btree (competition_id);
CREATE INDEX IF NOT EXISTS idx_contests_event ON public.contests USING btree (event_id) WHERE (event_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_contests_play_window ON public.contests USING btree (play_from, play_to) WHERE (play_from IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_contests_scheduled ON public.contests USING btree (scheduled_at) WHERE (scheduled_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_held ON public.conversation_participants USING btree (profile_id) WHERE (held_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_cp_conversation ON public.conversation_participants USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS idx_cp_profile_active ON public.conversation_participants USING btree (profile_id) WHERE (left_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON public.conversations USING btree (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_divisions_org ON public.divisions USING btree (org_id);
CREATE INDEX IF NOT EXISTS idx_divisions_season ON public.divisions USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_carpool_claims_offer ON public.event_carpool_claims USING btree (offer_id);
CREATE INDEX IF NOT EXISTS idx_carpool_offers_event ON public.event_carpool_offers USING btree (event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_guests_email_unique ON public.event_guests USING btree (event_id, invited_email) WHERE (invited_email IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_event_guests_profile ON public.event_guests USING btree (profile_id, status) WHERE (profile_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_guests_profile_unique ON public.event_guests USING btree (event_id, profile_id) WHERE (profile_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_event_series_horizon ON public.event_series USING btree (generated_until) WHERE (ends = 'never'::text);
CREATE INDEX IF NOT EXISTS idx_events_division_starts ON public.events USING btree (division_id, starts_at) WHERE (division_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_facility_id ON public.events USING btree (facility_id) WHERE (facility_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_org ON public.events USING btree (org_id) WHERE (org_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_organizer ON public.events USING btree (organizer_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_routine_id ON public.events USING btree (routine_id) WHERE (routine_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_series ON public.events USING btree (series_id, starts_at) WHERE (series_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_team_starts ON public.events USING btree (team_id, starts_at) WHERE (team_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_time ON public.events USING btree (starts_at) WHERE (status = 'active'::text);
CREATE INDEX IF NOT EXISTS idx_events_venue_id ON public.events USING btree (venue_id) WHERE (venue_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_facilities_venue_id ON public.facilities USING btree (venue_id);
CREATE INDEX IF NOT EXISTS idx_follows_composite ON public.follows USING btree (follower_id, following_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON public.follows USING btree (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_status ON public.follows USING btree (follower_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following ON public.follows USING btree (following_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_status ON public.follows USING btree (following_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_status ON public.follows USING btree (status);
CREATE INDEX IF NOT EXISTS idx_golf_courses_city_raw_trgm ON public.golf_courses USING gin (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_club_id ON public.golf_courses USING btree (club_id);
CREATE INDEX IF NOT EXISTS idx_golf_courses_club_trgm ON public.golf_courses USING gin (club_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_country_region ON public.golf_courses USING btree (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_golf_courses_hydrated_at ON public.golf_courses USING btree (hydrated_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_golf_courses_lat ON public.golf_courses USING btree (lat);
CREATE INDEX IF NOT EXISTS idx_golf_courses_name_raw_trgm ON public.golf_courses USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_place ON public.golf_courses USING btree (place_id);
CREATE INDEX IF NOT EXISTS idx_golf_courses_region_raw_trgm ON public.golf_courses USING gin (region gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_search ON public.golf_courses USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_golf_hole_scores_participant ON public.golf_hole_scores USING btree (golf_participant_id);
CREATE INDEX IF NOT EXISTS idx_golf_holes_round ON public.golf_holes USING btree (round_id, hole_number);
CREATE INDEX IF NOT EXISTS idx_golf_holes_round_id ON public.golf_holes USING btree (round_id);
CREATE INDEX IF NOT EXISTS idx_golf_participant_scores_participant ON public.golf_participant_scores USING btree (participant_id);
CREATE INDEX IF NOT EXISTS idx_golf_scores_entered_by ON public.golf_participant_scores USING btree (entered_by);
CREATE INDEX IF NOT EXISTS idx_golf_rounds_course_id ON public.golf_rounds USING btree (course_id);
CREATE INDEX IF NOT EXISTS idx_golf_rounds_course_prefix ON public.golf_rounds USING btree (lower(course) COLLATE "C");
CREATE INDEX IF NOT EXISTS idx_golf_rounds_course_trgm ON public.golf_rounds USING gin (lower(course) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_rounds_date ON public.golf_rounds USING btree (date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_golf_rounds_group_mirror ON public.golf_rounds USING btree (group_post_id, profile_id);
CREATE INDEX IF NOT EXISTS idx_golf_rounds_profile_date ON public.golf_rounds USING btree (profile_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_golf_rounds_profile_id ON public.golf_rounds USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_golf_scorecard_data_course_id ON public.golf_scorecard_data USING btree (course_id);
CREATE INDEX IF NOT EXISTS idx_golf_scorecard_group ON public.golf_scorecard_data USING btree (group_post_id);
CREATE INDEX IF NOT EXISTS idx_group_media_highlight ON public.group_post_media USING btree (group_post_id) WHERE is_highlight;
CREATE INDEX IF NOT EXISTS idx_group_media_segment ON public.group_post_media USING btree (group_post_id, segment_number);
CREATE INDEX IF NOT EXISTS idx_group_media_uploader ON public.group_post_media USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_group_post_media_group ON public.group_post_media USING btree (group_post_id);
CREATE INDEX IF NOT EXISTS idx_group_post_media_group_post_id ON public.group_post_media USING btree (group_post_id);
CREATE INDEX IF NOT EXISTS idx_group_post_media_uploader ON public.group_post_media USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_group_post_participants_group ON public.group_post_participants USING btree (group_post_id);
CREATE INDEX IF NOT EXISTS idx_group_post_participants_profile ON public.group_post_participants USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_group_post_participants_status ON public.group_post_participants USING btree (status);
CREATE INDEX IF NOT EXISTS idx_participants_position ON public.group_post_participants USING btree (group_post_id, "position");
CREATE INDEX IF NOT EXISTS idx_participants_profile ON public.group_post_participants USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_group_posts_contest ON public.group_posts USING btree (contest_id) WHERE (contest_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_group_posts_creator ON public.group_posts USING btree (creator_id);
CREATE INDEX IF NOT EXISTS idx_group_posts_date ON public.group_posts USING btree (date);
CREATE INDEX IF NOT EXISTS idx_group_posts_post ON public.group_posts USING btree (post_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_posts_sport_event_round ON public.group_posts USING btree (sport_event_round_id) WHERE (sport_event_round_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_group_posts_status ON public.group_posts USING btree (status);
CREATE INDEX IF NOT EXISTS idx_group_posts_type ON public.group_posts USING btree (type);
CREATE INDEX IF NOT EXISTS idx_guardian_invites_email ON public.guardian_invites USING btree (invited_email) WHERE (consumed_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_handle_history_profile_id ON public.handle_history USING btree (profile_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_help_articles_public ON public.help_articles USING btree (topic, sort_order, title) WHERE published;
CREATE INDEX IF NOT EXISTS idx_memberships_org ON public.memberships USING btree (org_id);
CREATE INDEX IF NOT EXISTS idx_memberships_profile ON public.memberships USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_memberships_season ON public.memberships USING btree (season_id) WHERE (season_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON public.message_reactions USING btree (message_id);
CREATE INDEX IF NOT EXISTS idx_message_reports_reported_profile ON public.message_reports USING btree (reported_profile_id);
CREATE INDEX IF NOT EXISTS idx_message_reports_reporter ON public.message_reports USING btree (reporter_id);
CREATE INDEX IF NOT EXISTS idx_message_reports_status_created ON public.message_reports USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON public.messages USING btree (conversation_id, created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON public.messages USING btree (parent_message_id) WHERE (parent_message_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages USING btree (sender_id);
CREATE INDEX IF NOT EXISTS idx_notifications_action_status ON public.notifications USING btree (action_status) WHERE (action_status IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notifications_actor_id ON public.notifications USING btree (actor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_follow_id ON public.notifications USING btree (follow_id);
CREATE INDEX IF NOT EXISTS idx_notifications_grouped ON public.notifications USING btree (grouped_notification_id) WHERE (grouped_notification_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notifications_metadata_gin ON public.notifications USING gin (metadata jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_notifications_post_id ON public.notifications USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_notifications_urgent_unmailed ON public.notifications USING btree (created_at) WHERE ((emailed_at IS NULL) AND (type = ANY (ARRAY['safety_alert'::text, 'consent_result'::text])));
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read, created_at DESC) WHERE (is_read = false);
CREATE INDEX IF NOT EXISTS idx_org_claim_invites_org ON public.org_claim_invites USING btree (org_id) WHERE (consumed_at IS NULL);
CREATE INDEX IF NOT EXISTS org_join_requests_org_idx ON public.org_join_requests USING btree (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_requests_status ON public.org_requests USING btree (kind, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS org_requests_one_pending ON public.org_requests USING btree (requester_profile_id) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_org_site_form_submissions_site_created ON public.org_site_form_submissions USING btree (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_site_hit_marks_day ON public.org_site_hit_marks USING btree (day);
CREATE INDEX IF NOT EXISTS idx_org_site_modules_site ON public.org_site_modules USING btree (site_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_org_site_news_feed ON public.org_site_news USING btree (site_id, published_at DESC);
CREATE INDEX IF NOT EXISTS org_site_news_site_pinned_idx ON public.org_site_news USING btree (site_id, pinned_at DESC NULLS LAST, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_site_pages_site ON public.org_site_pages USING btree (site_id);
CREATE INDEX IF NOT EXISTS idx_org_site_revisions_site_created ON public.org_site_revisions USING btree (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_site_stats_daily_site_day ON public.org_site_stats_daily USING btree (site_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_org_sites_org ON public.org_sites USING btree (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS org_sites_custom_domain_uniq ON public.org_sites USING btree (custom_domain) WHERE (custom_domain IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS org_sites_subdomain_lower_uniq ON public.org_sites USING btree (lower(subdomain));
CREATE INDEX IF NOT EXISTS idx_org_staff_audit_org ON public.org_staff_audit USING btree (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_staff_invites_org ON public.org_staff_invites USING btree (org_id) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_organizations_country_region ON public.organizations USING btree (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_organizations_kind ON public.organizations USING btree (kind);
CREATE INDEX IF NOT EXISTS idx_organizations_lat ON public.organizations USING btree (lat);
CREATE INDEX IF NOT EXISTS idx_organizations_name_trgm ON public.organizations USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON public.organizations USING btree (owner_profile_id);
CREATE INDEX IF NOT EXISTS idx_organizations_place ON public.organizations USING btree (place_id);
CREATE INDEX IF NOT EXISTS idx_organizations_search ON public.organizations USING gin (search_vector);
CREATE INDEX IF NOT EXISTS organizations_listing_idx ON public.organizations USING btree (listing_status) WHERE (listing_status <> 'listed'::text);
CREATE INDEX IF NOT EXISTS organizations_pending_idx ON public.organizations USING btree (created_at) WHERE (approved_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_pending_profiles_state ON public.pending_profiles USING btree (state, expires_at);
CREATE INDEX IF NOT EXISTS idx_performances_profile_id ON public.performances USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_place_aliases_norm ON public.place_aliases USING btree (alias_norm text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_places_ascii_norm ON public.places USING btree (search_normalize(ascii_name));
CREATE INDEX IF NOT EXISTS idx_places_country_region ON public.places USING btree (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_places_lat ON public.places USING btree (lat);
CREATE INDEX IF NOT EXISTS idx_places_name_norm ON public.places USING btree (search_normalize(name));
CREATE INDEX IF NOT EXISTS idx_places_name_trgm ON public.places USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_places_population ON public.places USING btree (population DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_places_search ON public.places USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_comments_created_by ON public.post_comments USING btree (created_by_user_id) WHERE (created_by_user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_comments_post ON public.post_comments USING btree (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_created ON public.post_comments USING btree (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_is_pinned ON public.post_comments USING btree (post_id) WHERE (is_pinned = true);
CREATE INDEX IF NOT EXISTS idx_post_comments_parent_comment_id ON public.post_comments USING btree (parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_pending_nudge ON public.post_comments USING btree (created_at) WHERE ((status = 'pending_approval'::text) AND (approval_nudged_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON public.post_comments USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_profile_id ON public.post_comments USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_status_pending ON public.post_comments USING btree (profile_id) WHERE (status <> 'published'::text);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON public.post_likes USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON public.post_likes USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_profile ON public.post_likes USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_likes_profile_id ON public.post_likes USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_post_media_post_display ON public.post_media USING btree (post_id, display_order);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON public.post_media USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_post_media_post_order ON public.post_media USING btree (post_id, display_order);
CREATE INDEX IF NOT EXISTS idx_post_tags_created_by ON public.post_tags USING btree (created_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_media_id ON public.post_tags USING btree (media_id) WHERE (media_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_post_tags_post_id ON public.post_tags USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_status ON public.post_tags USING btree (status);
CREATE INDEX IF NOT EXISTS idx_post_tags_tagged_profile ON public.post_tags USING btree (tagged_profile_id);
CREATE INDEX IF NOT EXISTS idx_posts_category_profile_created ON public.posts USING btree (post_category, profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_contest ON public.posts USING btree (contest_id) WHERE (contest_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_at_id_desc ON public.posts USING btree (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_by ON public.posts USING btree (created_by_user_id) WHERE (created_by_user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_event_id ON public.posts USING btree (event_id) WHERE (event_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_group_post_id ON public.posts USING btree (group_post_id);
CREATE INDEX IF NOT EXISTS idx_posts_pending_nudge ON public.posts USING btree (created_at) WHERE ((status = 'pending_approval'::text) AND (approval_nudged_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON public.posts USING btree (profile_id, pinned_at DESC) WHERE (is_pinned = true);
CREATE INDEX IF NOT EXISTS idx_posts_profile_created ON public.posts USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_profile_id ON public.posts USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_posts_profile_visibility_created ON public.posts USING btree (profile_id, visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_round_id ON public.posts USING btree (round_id);
CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON public.posts USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_posts_shared_post_id ON public.posts USING btree (shared_post_id) WHERE (shared_post_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_sport_event_round ON public.posts USING btree (sport_event_round_id) WHERE (sport_event_round_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_stat_line_date ON public.posts USING btree (profile_id, ((stats_data ->> 'date'::text))) WHERE ((stats_data ->> 'type'::text) = 'stat_line'::text);
CREATE INDEX IF NOT EXISTS idx_posts_stats_media ON public.posts USING btree (profile_id, created_at DESC) WHERE (((stats_data IS NOT NULL) AND (stats_data <> '{}'::jsonb)) OR (round_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_posts_status_pending ON public.posts USING btree (profile_id) WHERE (status <> 'published'::text);
CREATE INDEX IF NOT EXISTS idx_posts_tags_gin ON public.posts USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_posts_visibility_created ON public.posts USING btree (visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_settings_profile ON public.privacy_settings USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_access_guardians ON public.profile_access USING btree (profile_id) WHERE (role = 'guardian'::text);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_access_one_self_role ON public.profile_access USING btree (profile_id) WHERE (role = ANY (ARRAY['owner'::text, 'supervised'::text]));
CREATE INDEX IF NOT EXISTS idx_profile_access_profile_role ON public.profile_access USING btree (profile_id, role);
CREATE INDEX IF NOT EXISTS idx_profile_access_audit_profile ON public.profile_access_audit USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_transfers_cron ON public.profile_transfers USING btree (state) WHERE (state = ANY (ARRAY['cooling_off'::text, 'executing'::text, 'requested'::text, 'credentials_pending'::text, 'dual_confirm'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_transfers_one_active ON public.profile_transfers USING btree (profile_id) WHERE (state <> ALL (ARRAY['completed'::text, 'cancelled'::text, 'expired'::text, 'aborted'::text]));
CREATE INDEX IF NOT EXISTS idx_profiles_country_region ON public.profiles USING btree (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_profiles_deletion_requested ON public.profiles USING btree (deletion_requested_at) WHERE (deletion_requested_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_profiles_first_name_prefix ON public.profiles USING btree (lower(first_name) COLLATE "C");
CREATE INDEX IF NOT EXISTS idx_profiles_first_name_trgm ON public.profiles USING gin (lower(first_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_prefix ON public.profiles USING btree (lower(full_name) COLLATE "C");
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm ON public.profiles USING gin (lower(full_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_handle_prefix ON public.profiles USING btree (lower(handle) COLLATE "C");
CREATE INDEX IF NOT EXISTS idx_profiles_handle_trgm ON public.profiles USING gin (lower(handle) gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_unique_lower ON public.profiles USING btree (lower(handle));
CREATE INDEX IF NOT EXISTS idx_profiles_last_name_prefix ON public.profiles USING btree (lower(last_name) COLLATE "C");
CREATE INDEX IF NOT EXISTS idx_profiles_last_name_trgm ON public.profiles USING gin (lower(last_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_lat ON public.profiles USING btree (lat);
CREATE INDEX IF NOT EXISTS idx_profiles_moderation ON public.profiles USING btree (moderation_state) WHERE (moderation_state <> 'active'::text);
CREATE INDEX IF NOT EXISTS idx_profiles_place ON public.profiles USING btree (place_id);
CREATE INDEX IF NOT EXISTS idx_profiles_recruiting_open ON public.profiles USING btree (recruiting_status) WHERE (recruiting_status <> 'closed'::text);
CREATE INDEX IF NOT EXISTS idx_profiles_search ON public.profiles USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_profiles_supervised ON public.profiles USING btree (id) WHERE (supervision_state = 'supervised'::text);
CREATE INDEX IF NOT EXISTS idx_profiles_visibility ON public.profiles USING btree (visibility);
CREATE INDEX IF NOT EXISTS idx_programs_season ON public.programs USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_reg_windows_season ON public.registration_windows USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_registration_windows_org ON public.registration_windows USING btree (org_id);
CREATE INDEX IF NOT EXISTS idx_registrations_org ON public.registrations USING btree (org_id);
CREATE INDEX IF NOT EXISTS idx_registrations_profile ON public.registrations USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registrations_season ON public.registrations USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_reserved_handles_lower ON public.reserved_handles USING btree (lower(handle));
CREATE INDEX IF NOT EXISTS idx_risk_signals_unacked ON public.risk_signals USING btree (profile_id, created_at DESC) WHERE (acknowledged_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_safety_audit_profile ON public.safety_settings_audit USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sanction_grants_grantee_org ON public.sanction_grants USING btree (grantee_org_id);
CREATE UNIQUE INDEX IF NOT EXISTS sanction_grants_live_pair ON public.sanction_grants USING btree (grantor_org_id, grantee_org_id) WHERE (revoked_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_saved_posts_post_id ON public.saved_posts USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_saved_posts_profile_id ON public.saved_posts USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_scout_shortlists_athlete ON public.scout_shortlists USING btree (athlete_id);
CREATE INDEX IF NOT EXISTS idx_search_documents_country_region ON public.search_documents USING btree (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_search_documents_lat ON public.search_documents USING btree (lat);
CREATE INDEX IF NOT EXISTS idx_search_documents_owner ON public.search_documents USING btree (owner_id) WHERE (owner_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_search_documents_type ON public.search_documents USING btree (entity_type);
CREATE INDEX IF NOT EXISTS idx_search_documents_vector ON public.search_documents USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_season_highlights_season ON public.season_highlights USING btree (profile_id, season);
CREATE INDEX IF NOT EXISTS idx_season_highlights_sport ON public.season_highlights USING btree (profile_id, sport_key);
CREATE INDEX IF NOT EXISTS idx_seasons_org ON public.seasons USING btree (org_id);
CREATE INDEX IF NOT EXISTS idx_sport_event_group_members_group_position ON public.sport_event_group_members USING btree (group_id, "position");
CREATE INDEX IF NOT EXISTS idx_sport_event_groups_round_sequence ON public.sport_event_groups USING btree (sport_event_round_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sport_event_matches_round ON public.sport_event_matches USING btree (sport_event_round_id);
CREATE INDEX IF NOT EXISTS idx_sport_event_media_event ON public.sport_event_media USING btree (sport_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sport_event_media_round ON public.sport_event_media USING btree (sport_event_round_id);
CREATE INDEX IF NOT EXISTS idx_sport_event_media_uploader ON public.sport_event_media USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_sport_event_participants_event_status ON public.sport_event_participants USING btree (sport_event_id, status);
CREATE INDEX IF NOT EXISTS idx_sport_event_participants_profile_created ON public.sport_event_participants USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sport_event_rounds_course ON public.sport_event_rounds USING btree (course_id) WHERE (course_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sport_event_rounds_event_sequence ON public.sport_event_rounds USING btree (sport_event_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sport_event_stat_lines_profile ON public.sport_event_stat_lines USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sport_event_stat_lines_round ON public.sport_event_stat_lines USING btree (sport_event_round_id);
CREATE INDEX IF NOT EXISTS idx_sport_events_competition ON public.sport_events USING btree (competition_id) WHERE (competition_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sport_events_host_created ON public.sport_events USING btree (host_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sport_events_org ON public.sport_events USING btree (org_id) WHERE (org_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sport_events_status_starts ON public.sport_events USING btree (status, starts_on);
CREATE INDEX IF NOT EXISTS idx_sport_settings_composite ON public.sport_settings USING btree (profile_id, sport_key);
CREATE INDEX IF NOT EXISTS idx_sport_settings_jsonb ON public.sport_settings USING gin (settings);
CREATE INDEX IF NOT EXISTS idx_sport_settings_profile ON public.sport_settings USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_sport_settings_sport ON public.sport_settings USING btree (sport_key);
CREATE INDEX IF NOT EXISTS idx_sports_active ON public.sports USING btree (profile_id, active);
CREATE INDEX IF NOT EXISTS idx_team_entries_division ON public.team_entries USING btree (division_id);
CREATE INDEX IF NOT EXISTS idx_teams_org ON public.teams USING btree (org_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON public.ticket_events USING btree (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON public.tickets USING btree (status, severity, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_reporter ON public.tickets USING btree (reporter_profile_id, created_at DESC) WHERE (reporter_profile_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tickets_retention ON public.tickets USING btree (closed_at) WHERE ((closed_at IS NOT NULL) AND (anonymized_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_tickets_target_item ON public.tickets USING btree (target_type, target_id, created_at DESC) WHERE (target_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tickets_target_profile ON public.tickets USING btree (target_profile_id, created_at DESC) WHERE (target_profile_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks USING btree (blocked_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON public.user_blocks USING btree (blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_media_presets_profile ON public.user_media_presets USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_mutes_muter ON public.user_mutes USING btree (muter_id);
CREATE INDEX IF NOT EXISTS idx_venues_golf_club_id ON public.venues USING btree (golf_club_id) WHERE (golf_club_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_venues_golf_course_id ON public.venues USING btree (golf_course_id) WHERE (golf_course_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_venues_org ON public.venues USING btree (org_id) WHERE (org_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON public.waitlist USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_profile ON public.workout_exercises USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_session ON public.workout_exercises USING btree (session_id, "position");
CREATE INDEX IF NOT EXISTS idx_workout_routine_exercises_profile ON public.workout_routine_exercises USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_workout_routine_exercises_routine ON public.workout_routine_exercises USING btree (routine_id, "position");
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_routines_profile_name ON public.workout_routines USING btree (profile_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_workout_routines_profile_updated ON public.workout_routines USING btree (profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_active ON public.workout_sessions USING btree (profile_id) WHERE (status = 'active'::text);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_profile_started ON public.workout_sessions USING btree (profile_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise ON public.workout_sets USING btree (exercise_id, set_number);
CREATE INDEX IF NOT EXISTS idx_workout_sets_profile ON public.workout_sets USING btree (profile_id);

-- ── Views ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.clubs AS
SELECT id,
    name,
    description,
    location,
    created_at,
    updated_at,
    search_vector,
    place_id,
    city,
    region,
    region_code,
    country,
    country_code,
    lat,
    lng,
    location_source,
    owner_profile_id,
    operates_teams,
    operates_competitions,
    approved_at,
    sport_key AS primary_sport,
    visibility,
    join_policy,
    listing_status
   FROM organizations
  WHERE kind = 'club'::text;
ALTER VIEW public.clubs SET (security_invoker = true);

CREATE OR REPLACE VIEW public.leagues AS
SELECT id,
    name,
    description,
    sport_key,
    owner_profile_id,
    place_id,
    city,
    region,
    region_code,
    country,
    country_code,
    lat,
    lng,
    location_source,
    search_vector,
    created_at,
    updated_at,
    operates_competitions,
    operates_teams,
    approved_at,
    visibility,
    join_policy,
    listing_status
   FROM organizations
  WHERE kind = 'league'::text;
ALTER VIEW public.leagues SET (security_invoker = true);

-- ── Functions, pass 2 (109) ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_update_display_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Auto-generate display name from first/last name if empty
  IF NEW.first_name IS NOT NULL AND NEW.last_name IS NOT NULL THEN
    IF NEW.full_name IS NULL OR NEW.full_name = '' THEN
      NEW.full_name := NEW.first_name || ' ' || NEW.last_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_places_from_text(p_table regclass)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE n int;
BEGIN
  EXECUTE format($f$
    WITH parsed AS (
      SELECT t.id,
             public.search_normalize(btrim(split_part(t.location, ',', 1))) AS p1,
             public.search_normalize(btrim(split_part(t.location, ',', 2))) AS p2
      FROM %1$s t
      WHERE t.location IS NOT NULL AND btrim(t.location) <> ''
        AND (t.location_source IS NULL OR t.location_source <> 'user')
    ),
    cand AS (
      SELECT pr.id AS entity_id, pl.id AS place_id, pr.p2,
             (pr.p2 <> '' AND (
                public.search_normalize(pl.region) = pr.p2 OR public.search_normalize(pl.region_code) = pr.p2 OR
                public.search_normalize(pl.country) = pr.p2 OR public.search_normalize(pl.country_code) = pr.p2)) AS p2_match,
             count(*) OVER (PARTITION BY pr.id) AS n_cand,
             row_number() OVER (PARTITION BY pr.id ORDER BY
               (pr.p2 <> '' AND (
                public.search_normalize(pl.region) = pr.p2 OR public.search_normalize(pl.region_code) = pr.p2 OR
                public.search_normalize(pl.country) = pr.p2 OR public.search_normalize(pl.country_code) = pr.p2)) DESC,
               pl.population DESC NULLS LAST) AS rn
      FROM parsed pr
      JOIN LATERAL (
        SELECT pl.* FROM places pl
        WHERE public.search_normalize(pl.name) = pr.p1 OR public.search_normalize(pl.ascii_name) = pr.p1
        UNION
        SELECT pl.* FROM places pl
        JOIN place_aliases a ON a.geonames_id = pl.geonames_id
        WHERE a.alias_norm = pr.p1
      ) pl ON pr.p1 <> ''
    ),
    chosen AS (
      SELECT c.entity_id, c.place_id FROM cand c
      WHERE c.rn = 1 AND ((c.p2 <> '' AND c.p2_match) OR (c.p2 = '' AND c.n_cand = 1))
    )
    UPDATE %1$s t SET
      place_id = ch.place_id,
      city = f.city, region = f.region, region_code = f.region_code,
      country = f.country, country_code = f.country_code, lat = f.lat, lng = f.lng,
      location_source = 'backfill'
    FROM chosen ch, LATERAL public.place_fields(ch.place_id) f
    WHERE t.id = ch.entity_id AND t.place_id IS DISTINCT FROM ch.place_id
  $f$, p_table);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bump_hole_score_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.strokes, NEW.putts, NEW.fairway_hit, NEW.green_in_regulation, NEW.penalties)
     IS DISTINCT FROM
     (OLD.strokes, OLD.putts, OLD.fairway_hit, OLD.green_in_regulation, OLD.penalties) THEN
    NEW.version = OLD.version + 1;
  ELSE
    NEW.version = OLD.version;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bump_site_hit(p_site uuid, p_day date, p_path text, p_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new integer := 0;
BEGIN
  IF p_hash IS NOT NULL AND p_hash <> '' THEN
    INSERT INTO org_site_hit_marks (site_id, day, visitor_hash)
    VALUES (p_site, p_day, p_hash)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_new := 1; END IF;
  END IF;
  INSERT INTO org_site_stats_daily (site_id, day, path, views, visitors)
  VALUES (p_site, p_day, p_path, 1, v_new)
  ON CONFLICT (site_id, day, path) DO UPDATE
    SET views = org_site_stats_daily.views + 1,
        visitors = org_site_stats_daily.visitors + EXCLUDED.visitors;
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_golf_participant_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_golf_participant_id UUID;
  v_total_score INTEGER;
  v_holes_completed INTEGER;
  v_played_par INTEGER;
  v_to_par INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_golf_participant_id := OLD.golf_participant_id;
  ELSE
    v_golf_participant_id := NEW.golf_participant_id;
  END IF;

  SELECT
    COALESCE(SUM(strokes), 0),
    COUNT(*)
  INTO v_total_score, v_holes_completed
  FROM public.golf_hole_scores
  WHERE golf_participant_id = v_golf_participant_id;

  -- Real par for the PLAYED holes, from the round's hole_data; NULL when the
  -- round has no hole_data (legacy) → fall back to the old holes*4 estimate.
  SELECT SUM((elem->>'par')::int)
  INTO v_played_par
  FROM public.golf_participant_scores gps
  JOIN public.group_post_participants gpp ON gpp.id = gps.participant_id
  JOIN public.golf_scorecard_data gsd ON gsd.group_post_id = gpp.group_post_id
  CROSS JOIN LATERAL jsonb_array_elements(gsd.hole_data) elem
  WHERE gps.id = v_golf_participant_id
    AND gsd.hole_data IS NOT NULL
    AND (elem->>'hole')::int IN (
      SELECT hole_number FROM public.golf_hole_scores
      WHERE golf_participant_id = v_golf_participant_id
    );

  IF v_holes_completed > 0 THEN
    v_to_par := v_total_score - COALESCE(v_played_par, v_holes_completed * 4);
  ELSE
    v_to_par := NULL;
  END IF;

  UPDATE public.golf_participant_scores
  SET
    total_score = v_total_score,
    to_par = v_to_par,
    holes_completed = v_holes_completed,
    updated_at = NOW()
  WHERE id = v_golf_participant_id;

  UPDATE public.group_post_participants
  SET
    data_contributed = (v_holes_completed > 0),
    last_contribution = CASE WHEN v_holes_completed > 0 THEN NOW() ELSE last_contribution END,
    updated_at = NOW()
  WHERE id = (
    SELECT participant_id FROM public.golf_participant_scores WHERE id = v_golf_participant_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_round_stats(round_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    total_strokes INTEGER;
    total_putts_calc INTEGER;
    total_par INTEGER;
    fir_count INTEGER;
    fir_eligible INTEGER;
    gir_count INTEGER;
    total_holes INTEGER;
BEGIN
    -- Get basic stats from holes
    SELECT
        COALESCE(SUM(strokes), 0),
        COALESCE(SUM(putts), 0),
        COALESCE(SUM(par), 0),
        COUNT(*) FILTER (WHERE fairway_hit = true),
        COUNT(*) FILTER (WHERE par > 3),
        COUNT(*) FILTER (WHERE green_in_regulation = true),
        COUNT(*)
    INTO total_strokes, total_putts_calc, total_par, fir_count, fir_eligible, gir_count, total_holes
    FROM public.golf_holes
    WHERE round_id = round_uuid;

    -- Update round with calculated stats
    UPDATE public.golf_rounds
    SET
        gross_score = CASE WHEN total_strokes > 0 THEN total_strokes ELSE gross_score END,
        par = CASE WHEN total_par > 0 THEN total_par ELSE par END,
        total_putts = CASE WHEN total_putts_calc > 0 THEN total_putts_calc ELSE total_putts END,
        fir_percentage = CASE WHEN fir_eligible > 0 THEN ROUND((fir_count::decimal / fir_eligible) * 100, 1) ELSE fir_percentage END,
        gir_percentage = CASE WHEN total_holes > 0 THEN ROUND((gir_count::decimal / total_holes) * 100, 1) ELSE gir_percentage END,
        is_complete = (total_holes >= holes),
        updated_at = now()
    WHERE id = round_uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_view_group_post(gp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.group_posts
    WHERE id = gp_id AND (visibility = 'public' OR creator_id = auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.group_post_participants
    WHERE group_post_id = gp_id AND profile_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_view_profile(target_profile_id uuid, viewer_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  profile_vis TEXT;
  is_following BOOLEAN;
BEGIN
  SELECT visibility INTO profile_vis
  FROM public.profiles
  WHERE id = target_profile_id;

  -- Own profile
  IF target_profile_id = viewer_id THEN
    RETURN TRUE;
  END IF;

  -- Guardian / supervised / viewer access rows (guardian-profiles feature)
  IF viewer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profile_access
    WHERE profile_id = target_profile_id AND user_id = viewer_id
  ) THEN
    RETURN TRUE;
  END IF;

  -- Public profile
  IF profile_vis = 'public' THEN
    RETURN TRUE;
  END IF;

  -- Private profile - check if following
  SELECT EXISTS (
    SELECT 1 FROM public.follows
    WHERE follower_id = viewer_id
      AND following_id = target_profile_id
      AND status = 'accepted'
  ) INTO is_following;

  RETURN is_following;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_handle_availability(input_handle text, current_profile_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(available boolean, reason text, suggestions text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  clean_handle TEXT;
  is_valid BOOLEAN;
  existing_profile UUID;
  is_reserved BOOLEAN;
BEGIN
  -- Clean the handle
  clean_handle := LOWER(TRIM(input_handle));

  -- Check if valid format (inline validation)
  is_valid := (
    LENGTH(clean_handle) >= 3 AND
    LENGTH(clean_handle) <= 20 AND
    clean_handle ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$' AND
    NOT clean_handle ~ '[._]{2,}'
  );

  IF NOT is_valid THEN
    RETURN QUERY SELECT
      FALSE,
      'Invalid format. Use 3-20 characters: letters, numbers, dots, underscores.',
      ARRAY[]::TEXT[];
    RETURN;
  END IF;

  -- Check if reserved
  SELECT EXISTS (
    SELECT 1 FROM public.reserved_handles
    WHERE LOWER(handle) = clean_handle
  ) INTO is_reserved;

  IF is_reserved THEN
    RETURN QUERY SELECT
      FALSE,
      'This handle is reserved.',
      ARRAY[clean_handle || '1', clean_handle || '_', clean_handle || '2']::TEXT[];
    RETURN;
  END IF;

  -- Check if already taken
  SELECT id INTO existing_profile
  FROM public.profiles
  WHERE LOWER(handle) = clean_handle
    AND (current_profile_id IS NULL OR id != current_profile_id)
  LIMIT 1;

  IF existing_profile IS NOT NULL THEN
    -- Generate suggestions
    RETURN QUERY SELECT
      FALSE,
      'This handle is already taken.',
      ARRAY[
        clean_handle || '1',
        clean_handle || '_',
        clean_handle || '2',
        clean_handle || '.' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 3)
      ]::TEXT[];
    RETURN;
  END IF;

  -- Available!
  RETURN QUERY SELECT
    TRUE,
    'Handle is available!',
    ARRAY[]::TEXT[];
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- SCHEMA-QUALIFIED notifications table
  DELETE FROM public.notifications
  WHERE is_read = true AND read_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consent_records_forbid_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     -- each FK: unchanged, or transitioning to NULL
     AND (NEW.profile_id IS NOT DISTINCT FROM OLD.profile_id
          OR (NEW.profile_id IS NULL AND OLD.profile_id IS NOT NULL))
     AND (NEW.guardian_user_id IS NOT DISTINCT FROM OLD.guardian_user_id
          OR (NEW.guardian_user_id IS NULL AND OLD.guardian_user_id IS NOT NULL))
     -- at least one FK actually changing (no-op updates stay forbidden)
     AND (NEW.profile_id IS DISTINCT FROM OLD.profile_id
          OR NEW.guardian_user_id IS DISTINCT FROM OLD.guardian_user_id)
     -- everything else identical
     AND (to_jsonb(NEW) - 'profile_id' - 'guardian_user_id')
         = (to_jsonb(OLD) - 'profile_id' - 'guardian_user_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rows in consent_records are append-only';
END; $function$;

CREATE OR REPLACE FUNCTION public.create_managed_profile(p_profile jsonb, p_guardian uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  new_id uuid;
BEGIN
  IF (
    SELECT count(*) FROM public.profile_access
    WHERE user_id = p_guardian AND role = 'guardian'
  ) >= 10 THEN
    RAISE EXCEPTION 'guardian % manages too many profiles', p_guardian;
  END IF;

  INSERT INTO public.profiles
  SELECT * FROM jsonb_populate_record(NULL::public.profiles, p_profile)
  RETURNING id INTO new_id;

  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (p_guardian, new_id, 'guardian', p_guardian);

  INSERT INTO public.profile_access_audit (profile_id, user_id, action, new_role, actor_id)
  VALUES (new_id, p_guardian, 'granted', 'guardian', p_guardian);

  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_type text, p_actor_id uuid, p_title text, p_message text DEFAULT NULL::text, p_action_url text DEFAULT NULL::text, p_post_id uuid DEFAULT NULL::uuid, p_comment_id uuid DEFAULT NULL::uuid, p_follow_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_notification_id UUID;
  v_preferences RECORD;
BEGIN
  -- Don't notify self
  IF p_actor_id = p_user_id THEN RETURN NULL; END IF;

  -- Get or create preferences (SCHEMA-QUALIFIED)
  SELECT * INTO v_preferences
  FROM public.notification_preferences
  WHERE user_id = p_user_id;

  IF v_preferences IS NULL THEN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_preferences;
  END IF;

  -- Check if notification type is enabled
  IF (
    (p_type = 'follow_request' AND v_preferences.follow_requests_enabled) OR
    (p_type = 'follow_accepted' AND v_preferences.follow_accepted_enabled) OR
    (p_type = 'new_follower' AND v_preferences.new_followers_enabled) OR
    (p_type = 'like' AND v_preferences.likes_enabled) OR
    (p_type = 'comment' AND v_preferences.comments_enabled) OR
    (p_type = 'mention' AND v_preferences.mentions_enabled) OR
    (p_type = 'tag' AND v_preferences.tags_enabled) OR
    (p_type = 'achievement' AND v_preferences.achievements_enabled) OR
    (p_type = 'system_announcement' AND v_preferences.system_announcements_enabled) OR
    (p_type = 'club_update' AND v_preferences.club_updates_enabled)
  ) THEN
    INSERT INTO public.notifications (
      user_id, type, actor_id, title, message, action_url,
      post_id, comment_id, follow_id, metadata
    ) VALUES (
      p_user_id, p_type, p_actor_id, p_title, p_message, p_action_url,
      p_post_id, p_comment_id, p_follow_id, p_metadata
    )
    RETURNING id INTO v_notification_id;
    RETURN v_notification_id;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_profile_with_owner(p_profile jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.profiles
  SELECT * FROM jsonb_populate_record(NULL::public.profiles, p_profile)
  RETURNING id INTO new_id;

  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (new_id, new_id, 'owner', new_id);

  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_stub_profile(p_id uuid, p_email text, p_first_name text, p_last_name text, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_full text := trim(p_first_name || ' ' || coalesce(p_last_name, ''));
BEGIN
  INSERT INTO public.profiles
    (id, email, first_name, last_name, full_name, display_name,
     user_type, visibility, supervision_state)
  VALUES
    (p_id, p_email, p_first_name, NULLIF(p_last_name, ''), v_full, v_full,
     'athlete', 'private', 'supervised');

  -- 048: a supervised SELF row is legal (user_id = profile_id) and takes
  -- the one-self-role slot. The adult claim FLIPS it to owner; the
  -- guardian claim DELETES it (after the guardian row exists) so the
  -- credentials_gap queue item surfaces.
  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (p_id, p_id, 'supervised', p_created_by);

  INSERT INTO public.profile_access_audit (profile_id, user_id, action, new_role, actor_id)
  VALUES (p_id, p_id, 'granted', 'supervised', p_created_by);

  RETURN p_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.decrement_comment_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.post_comments
  SET likes_count = GREATEST(0, likes_count - 1)
  WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrement_post_save_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.posts
  SET saves_count = GREATEST(0, saves_count - 1)
  WHERE id = OLD.post_id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_guardian_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.role = 'guardian' AND (
    SELECT count(*) FROM public.profile_access
    WHERE profile_id = NEW.profile_id AND role = 'guardian'
  ) > 2 THEN
    RAISE EXCEPTION 'profile % already has the maximum of 2 guardians', NEW.profile_id;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_last_guardian()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Only departures from the guardian role matter.
  IF OLD.role <> 'guardian' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'guardian' THEN
    RETURN NULL;
  END IF;

  -- Cascade tolerance: either side's profiles row already gone = a cascade
  -- in flight; the app layer owns those flows.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.profile_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
    RETURN NULL;
  END IF;

  -- Only supervised, un-parked children are protected.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = OLD.profile_id
      AND supervision_state = 'supervised'
      AND deletion_requested_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- The transfer executor's flip_access→finalize window.
  IF EXISTS (
    SELECT 1 FROM public.profile_transfers
    WHERE profile_id = OLD.profile_id AND state = 'executing'
  ) THEN
    RETURN NULL;
  END IF;

  -- Deferred AFTER trigger: the count reflects the transaction's final state.
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_access
    WHERE profile_id = OLD.profile_id AND role = 'guardian'
  ) THEN
    RAISE EXCEPTION
      'profile % must keep at least one guardian while supervised (last-guardian backstop, migration 136)',
      OLD.profile_id;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_profile_has_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  affected UUID;
BEGIN
  affected := COALESCE(OLD.profile_id, NEW.profile_id);
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = affected)
     AND NOT EXISTS (SELECT 1 FROM public.profile_access WHERE profile_id = affected) THEN
    RAISE EXCEPTION 'profile % cannot be left with zero access rows', affected;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.feed_following(p_viewer uuid, p_limit integer, p_cursor_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_offset integer DEFAULT 0)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.follows_counts_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  old_live boolean := (TG_OP <> 'INSERT') AND (OLD.status = 'accepted');
  new_live boolean := (TG_OP <> 'DELETE') AND (NEW.status = 'accepted');
BEGIN
  -- Only an accepted edge counts. A row that stays accepted but changes
  -- another column is a no-op; a row that changes its endpoints (never
  -- done by the app) is handled as remove-then-add.
  IF old_live AND new_live AND OLD.follower_id = NEW.follower_id AND OLD.following_id = NEW.following_id THEN
    RETURN NULL;
  END IF;
  IF old_live THEN
    UPDATE public.profiles SET followers_count = GREATEST(0, COALESCE(followers_count, 0) - 1) WHERE id = OLD.following_id;
    UPDATE public.profiles SET following_count = GREATEST(0, COALESCE(following_count, 0) - 1) WHERE id = OLD.follower_id;
  END IF;
  IF new_live THEN
    UPDATE public.profiles SET followers_count = COALESCE(followers_count, 0) + 1 WHERE id = NEW.following_id;
    UPDATE public.profiles SET following_count = COALESCE(following_count, 0) + 1 WHERE id = NEW.follower_id;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.forbid_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'rows in % are append-only', TG_TABLE_NAME;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_connection_suggestions(p_user_profile_id uuid, p_suggestion_limit integer DEFAULT 10)
 RETURNS TABLE(suggested_id uuid, suggested_name text, suggested_avatar text, suggested_sport text, suggested_school text, suggested_location text, similarity_score integer, reason text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_sport TEXT;
  v_user_school TEXT;
  v_user_location TEXT;
BEGIN
  -- First, get the requesting user's profile data
  SELECT
    sport,
    school,
    location
  INTO
    v_user_sport,
    v_user_school,
    v_user_location
  FROM public.profiles
  WHERE id = p_user_profile_id;

  -- Return suggested profiles
  RETURN QUERY
  SELECT
    p.id AS suggested_id,
    COALESCE(
      p.full_name,
      NULLIF(TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))), '')
    ) AS suggested_name,
    p.avatar_url AS suggested_avatar,
    p.sport AS suggested_sport,
    p.school AS suggested_school,
    p.location AS suggested_location,
    -- Calculate similarity score
    (
      CASE WHEN p.sport IS NOT NULL AND p.sport = v_user_sport THEN 30 ELSE 0 END +
      CASE WHEN p.school IS NOT NULL AND p.school = v_user_school THEN 20 ELSE 0 END +
      CASE WHEN p.location IS NOT NULL AND p.location = v_user_location THEN 10 ELSE 0 END +
      -- Bonus points for common connections (capped at 25 points)
      LEAST(
        COALESCE((
          SELECT COUNT(*)::INTEGER * 5
          FROM public.follows f1
          INNER JOIN public.follows f2 ON f1.following_id = f2.following_id
          WHERE f1.follower_id = p_user_profile_id
            AND f2.follower_id = p.id
            AND f1.status = 'accepted'
            AND f2.status = 'accepted'
        ), 0),
        25
      )
    )::INTEGER AS similarity_score,
    -- Generate human-readable reason
    CASE
      WHEN p.sport IS NOT NULL AND p.sport = v_user_sport THEN
        CONCAT('Also plays ', p.sport)
      WHEN p.school IS NOT NULL AND p.school = v_user_school THEN
        CONCAT('Also attends ', p.school)
      WHEN p.location IS NOT NULL AND p.location = v_user_location THEN
        CONCAT('Also from ', p.location)
      WHEN EXISTS (
        SELECT 1 FROM public.follows f1
        INNER JOIN public.follows f2 ON f1.following_id = f2.following_id
        WHERE f1.follower_id = p_user_profile_id
          AND f2.follower_id = p.id
          AND f1.status = 'accepted'
          AND f2.status = 'accepted'
        LIMIT 1
      ) THEN
        'Has mutual connections'
      ELSE
        'Suggested for you'
    END AS reason
  FROM public.profiles p
  WHERE p.id != p_user_profile_id
    -- Only public profiles
    AND p.visibility = 'public'
    -- Exclude profiles already being followed or with pending requests
    AND NOT EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = p_user_profile_id
        AND f.following_id = p.id
    )
    -- Exclude previously dismissed suggestions
    AND NOT EXISTS (
      SELECT 1 FROM public.connection_suggestions cs
      WHERE cs.profile_id = p_user_profile_id
        AND cs.suggested_profile_id = p.id
        AND cs.dismissed = true
    )
  ORDER BY similarity_score DESC, p.created_at DESC
  LIMIT p_suggestion_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_actor_display_name(p_profile_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_name TEXT;
BEGIN
  SELECT COALESCE(
    NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
    full_name,
    'Someone'
  )
  INTO v_name
  FROM public.profiles
  WHERE id = p_profile_id;

  RETURN COALESCE(v_name, 'Someone');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_conversation_list(p_user_id uuid, p_limit integer DEFAULT NULL::integer, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH my_convs AS (
    SELECT cp.conversation_id, cp.last_read_at, cp.joined_at
    FROM public.conversation_participants cp
    WHERE cp.profile_id = p_user_id
      AND cp.left_at IS NULL
      AND cp.held_at IS NULL            -- 131: held children see nothing
  )
  SELECT COALESCE(jsonb_agg(sub.conv_json ORDER BY sub.updated_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      c.updated_at,
      jsonb_build_object(
        'id', c.id,
        'type', c.type,
        'name', c.name,
        'avatar_url', c.avatar_url,
        'created_by', c.created_by,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        -- All active participants (for avatars/names; the client derives the
        -- "other" participant of a DM from this). held_at exposed (131) so
        -- the SENDER can render the "waiting for approval" chip.
        'participants', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', pp.id,
            'conversation_id', pp.conversation_id,
            'profile_id', pp.profile_id,
            'role', pp.role,
            'last_read_at', pp.last_read_at,
            'is_muted', pp.is_muted,
            'joined_at', pp.joined_at,
            'left_at', pp.left_at,
            'held_at', pp.held_at,
            'profile', jsonb_build_object(
              'id', pr.id,
              'first_name', pr.first_name,
              'last_name', pr.last_name,
              'full_name', pr.full_name,
              'avatar_url', pr.avatar_url,
              'handle', pr.handle
            )
          ))
          FROM public.conversation_participants pp
          JOIN public.profiles pr ON pr.id = pp.profile_id
          WHERE pp.conversation_id = c.id
            AND pp.left_at IS NULL
        ), '[]'::jsonb),
        -- Latest non-deleted message, with its sender's profile.
        'last_message', (
          SELECT jsonb_build_object(
            'id', m.id,
            'conversation_id', m.conversation_id,
            'sender_id', m.sender_id,
            'type', m.type,
            'content', m.content,
            'media_url', m.media_url,
            'media_type', m.media_type,
            'shared_post_id', m.shared_post_id,
            'shared_profile_id', m.shared_profile_id,
            'deleted_at', m.deleted_at,
            'created_at', m.created_at,
            'updated_at', m.updated_at,
            'sender', jsonb_build_object(
              'id', sp.id,
              'first_name', sp.first_name,
              'last_name', sp.last_name,
              'full_name', sp.full_name,
              'avatar_url', sp.avatar_url,
              'handle', sp.handle
            )
          )
          FROM public.messages m
          JOIN public.profiles sp ON sp.id = m.sender_id
          WHERE m.conversation_id = c.id
            AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC
          LIMIT 1
        ),
        -- Messages from OTHERS after the unread floor (later of last_read_at
        -- and joined_at). GREATEST ignores NULLs → null last_read_at = joined_at.
        'unread_count', (
          SELECT count(*)
          FROM public.messages um
          WHERE um.conversation_id = c.id
            AND um.sender_id <> p_user_id
            AND um.deleted_at IS NULL
            AND (
              GREATEST(mc.last_read_at, mc.joined_at) IS NULL
              OR um.created_at > GREATEST(mc.last_read_at, mc.joined_at)
            )
        ),
        'my_participant', jsonb_build_object(
          'id', myp.id,
          'conversation_id', myp.conversation_id,
          'profile_id', myp.profile_id,
          'role', myp.role,
          'last_read_at', myp.last_read_at,
          'is_muted', myp.is_muted,
          'joined_at', myp.joined_at,
          'left_at', myp.left_at,
          'held_at', myp.held_at,
          'profile', jsonb_build_object(
            'id', mypr.id,
            'first_name', mypr.first_name,
            'last_name', mypr.last_name,
            'full_name', mypr.full_name,
            'avatar_url', mypr.avatar_url,
            'handle', mypr.handle
          )
        )
      ) AS conv_json
    FROM my_convs mc
    JOIN public.conversations c ON c.id = mc.conversation_id
    JOIN public.conversation_participants myp
      ON myp.conversation_id = c.id
     AND myp.profile_id = p_user_id
     AND myp.left_at IS NULL
     AND myp.held_at IS NULL            -- 131 (mirror of my_convs)
    JOIN public.profiles mypr ON mypr.id = p_user_id
    WHERE (p_before IS NULL OR c.updated_at < p_before)
    ORDER BY c.updated_at DESC
    LIMIT p_limit
  ) sub;
$function$;

CREATE OR REPLACE FUNCTION public.get_golf_round_years(p_profile_id uuid)
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(array_agg(y ORDER BY y DESC), '{}')
  FROM (
    SELECT DISTINCT (substring(r.date::text, 1, 4))::int AS y
    FROM public.golf_rounds r
    WHERE r.profile_id = p_profile_id
      AND r.date IS NOT NULL
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.get_golf_scorecard(p_group_post_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'golf_data', (
      SELECT row_to_json(gd)
      FROM (
        SELECT
          course_name,
          round_type,
          holes_played,
          tee_color,
          slope_rating,
          course_rating,
          weather_conditions,
          temperature,
          wind_speed
        FROM public.golf_scorecard_data
        WHERE group_post_id = p_group_post_id
      ) gd
    ),
    'participant_scores', (
      SELECT json_agg(
        json_build_object(
          'participant_id', gpp.id,
          'profile_id', gpp.profile_id,
          'profile', (
            SELECT row_to_json(p)
            FROM (
              SELECT id, full_name, first_name, last_name, avatar_url
              FROM public.profiles
              WHERE id = gpp.profile_id
            ) p
          ),
          'status', gpp.status,
          'total_score', gps.total_score,
          'to_par', gps.to_par,
          'holes_completed', gps.holes_completed,
          'scores_confirmed', gps.scores_confirmed,
          'hole_scores', (
            -- ORDER BY lives INSIDE the aggregate; see the header note. At
            -- query level (as 004 had it) this raises 42803.
            SELECT json_object_agg(
              ghs.hole_number,
              json_build_object(
                'strokes', ghs.strokes,
                'putts', ghs.putts,
                'fairway_hit', ghs.fairway_hit,
                'green_in_regulation', ghs.green_in_regulation
              )
              ORDER BY ghs.hole_number
            )
            FROM public.golf_hole_scores ghs
            WHERE ghs.golf_participant_id = gps.id
          )
        )
        ORDER BY gpp.created_at
      )
      FROM public.group_post_participants gpp
      LEFT JOIN public.golf_participant_scores gps ON gps.participant_id = gpp.id
      WHERE gpp.group_post_id = p_group_post_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_post_details(p_group_post_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'group_post', (
      SELECT row_to_json(gp)
      FROM (
        SELECT
          id,
          creator_id,
          type,
          title,
          description,
          date,
          location,
          visibility,
          status,
          post_id,
          created_at,
          updated_at
        FROM public.group_posts
        WHERE id = p_group_post_id
      ) gp
    ),
    'participants', (
      SELECT json_agg(
        json_build_object(
          'id', gpp.id,
          'profile_id', gpp.profile_id,
          'profile', (
            SELECT row_to_json(p)
            FROM (
              SELECT id, full_name, first_name, last_name, avatar_url, sport, school
              FROM public.profiles
              WHERE id = gpp.profile_id
            ) p
          ),
          'status', gpp.status,
          'role', gpp.role,
          'attested_at', gpp.attested_at,
          'data_contributed', gpp.data_contributed,
          'last_contribution', gpp.last_contribution
        )
        ORDER BY gpp.created_at
      )
      FROM public.group_post_participants gpp
      WHERE gpp.group_post_id = p_group_post_id
    ),
    'media', (
      SELECT json_agg(
        json_build_object(
          'id', gpm.id,
          'media_url', gpm.media_url,
          'media_type', gpm.media_type,
          'caption', gpm.caption,
          'uploaded_by', gpm.uploaded_by,
          'created_at', gpm.created_at
        )
        ORDER BY gpm.position, gpm.created_at
      )
      FROM public.group_post_media gpm
      WHERE gpm.group_post_id = p_group_post_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_requests_count(target_profile_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM public.follows
  WHERE following_id = target_profile_id
  AND status = 'pending';

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_all_media(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid, media_limit integer DEFAULT 20, media_offset integer DEFAULT 0, filter_sport_keys text[] DEFAULT NULL::text[], filter_years integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, caption text, sport_key text, stats_data jsonb, round_id uuid, visibility text, created_at timestamp with time zone, profile_id uuid, profile_first_name text, profile_last_name text, profile_full_name text, profile_avatar_url text, media_count bigint, likes_count integer, comments_count integer, saves_count integer, tags text[], hashtags text[], is_own_post boolean, is_tagged boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id, p.caption, p.sport_key, p.stats_data, p.round_id, p.visibility,
      p.created_at, p.profile_id,
      prof.first_name AS profile_first_name, prof.last_name AS profile_last_name,
      prof.full_name AS profile_full_name, prof.avatar_url AS profile_avatar_url,
      (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
      p.likes_count, p.comments_count, COALESCE(p.saves_count, 0) AS saves_count,
      p.tags, p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      p.profile_id = target_profile_id
      OR p.tags @> ARRAY[target_profile_id::TEXT]
    )
    -- 074: MEDIA inverse predicate — statements moved to
    -- get_profile_statements_media; together they partition the old set.
    AND (
      (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
      OR p.round_id IS NOT NULL
      OR p.group_post_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
    )
    AND (
      p.visibility = 'public'
      OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
      OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
      OR (
        viewer_id IS NOT NULL
        AND p.visibility = 'private'
        AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = viewer_id
          AND f.following_id = p.profile_id
          AND f.status = 'accepted'
        )
      )
    )
    -- Post-OWNER visibility (mirrors 066's get_profile_tagged_media)
    AND (
      prof.visibility = 'public'
      OR (viewer_id IS NOT NULL AND (
        viewer_id = p.profile_id
        OR viewer_id = target_profile_id
        OR EXISTS (
          SELECT 1 FROM follows f2
          WHERE f2.follower_id = viewer_id
          AND f2.following_id = p.profile_id
          AND f2.status = 'accepted'
        )
      ))
    )
    AND (p.status = 'published'
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_media_counts(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(all_media_count bigint, stats_media_count bigint, tagged_media_count bigint, statements_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR p.tags @> ARRAY[target_profile_id::TEXT]
      )
      -- 074: MEDIA inverse predicate — must match get_profile_all_media
      -- above, or the badge and the grid disagree (the 068 drift).
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
        OR p.group_post_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = p.id)
      )
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
      -- Post-owner visibility (mirrors the tagged subquery below)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS all_media_count,
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR p.tags @> ARRAY[target_profile_id::TEXT]
      )
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
        -- 070: must match get_profile_stats_media, or the badge and the
        -- grid disagree — the exact drift 068 was written to fix.
        OR p.group_post_id IS NOT NULL
      )
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
      -- Post-owner visibility (mirrors the tagged subquery below)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS stats_media_count,
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE p.tags @> ARRAY[target_profile_id::TEXT]
      AND p.profile_id != target_profile_id
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
      -- Post-owner visibility (mirrors get_profile_tagged_media)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS tagged_media_count,
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR p.tags @> ARRAY[target_profile_id::TEXT]
      )
      -- 074: STATEMENT predicate — must match get_profile_statements_media
      -- above (born together, drift never).
      AND (p.stats_data IS NULL OR p.stats_data = '{}'::jsonb)
      AND p.round_id IS NULL
      AND p.group_post_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = p.id)
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
      -- Post-owner visibility (mirrors the tagged subquery above)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS statements_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_post_sport_keys(p_profile_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(array_agg(DISTINCT p.sport_key), '{}')
  FROM public.posts p
  WHERE p.profile_id = p_profile_id
    AND p.sport_key IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_statements_media(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid, media_limit integer DEFAULT 20, media_offset integer DEFAULT 0, filter_sport_keys text[] DEFAULT NULL::text[], filter_years integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, caption text, sport_key text, stats_data jsonb, round_id uuid, visibility text, created_at timestamp with time zone, profile_id uuid, profile_first_name text, profile_last_name text, profile_full_name text, profile_avatar_url text, media_count bigint, likes_count integer, comments_count integer, saves_count integer, tags text[], hashtags text[], is_own_post boolean, is_tagged boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id, p.caption, p.sport_key, p.stats_data, p.round_id, p.visibility,
      p.created_at, p.profile_id,
      prof.first_name AS profile_first_name, prof.last_name AS profile_last_name,
      prof.full_name AS profile_full_name, prof.avatar_url AS profile_avatar_url,
      (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
      p.likes_count, p.comments_count, COALESCE(p.saves_count, 0) AS saves_count,
      p.tags, p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      p.profile_id = target_profile_id
      OR p.tags @> ARRAY[target_profile_id::TEXT]
    )
    -- 074: STATEMENT predicate — text-only posts only
    AND (p.stats_data IS NULL OR p.stats_data = '{}'::jsonb)
    AND p.round_id IS NULL
    AND p.group_post_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
    AND (
      p.visibility = 'public'
      OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
      OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
      OR (
        viewer_id IS NOT NULL
        AND p.visibility = 'private'
        AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = viewer_id
          AND f.following_id = p.profile_id
          AND f.status = 'accepted'
        )
      )
    )
    -- Post-OWNER visibility (mirrors 066's get_profile_tagged_media)
    AND (
      prof.visibility = 'public'
      OR (viewer_id IS NOT NULL AND (
        viewer_id = p.profile_id
        OR viewer_id = target_profile_id
        OR EXISTS (
          SELECT 1 FROM follows f2
          WHERE f2.follower_id = viewer_id
          AND f2.following_id = p.profile_id
          AND f2.status = 'accepted'
        )
      ))
    )
    AND (p.status = 'published'
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_stats_media(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid, media_limit integer DEFAULT 20, media_offset integer DEFAULT 0, filter_sport_keys text[] DEFAULT NULL::text[], filter_years integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, caption text, sport_key text, stats_data jsonb, round_id uuid, visibility text, created_at timestamp with time zone, profile_id uuid, profile_first_name text, profile_last_name text, profile_full_name text, profile_avatar_url text, media_count bigint, likes_count integer, comments_count integer, saves_count integer, tags text[], hashtags text[], is_own_post boolean, is_tagged boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id, p.caption, p.sport_key, p.stats_data, p.round_id, p.visibility,
      p.created_at, p.profile_id,
      prof.first_name AS profile_first_name, prof.last_name AS profile_last_name,
      prof.full_name AS profile_full_name, prof.avatar_url AS profile_avatar_url,
      (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
      p.likes_count, p.comments_count, COALESCE(p.saves_count, 0) AS saves_count,
      p.tags, p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      (p.profile_id = target_profile_id OR p.tags @> ARRAY[target_profile_id::TEXT])
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
        -- 070: shared (multi-player) rounds carry neither stats_data nor
        -- round_id; their scores live in golf_scorecard_data.
        OR p.group_post_id IS NOT NULL
      )
    )
    AND (
      p.visibility = 'public'
      OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
      OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
      OR (
        viewer_id IS NOT NULL
        AND p.visibility = 'private'
        AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = viewer_id
          AND f.following_id = p.profile_id
          AND f.status = 'accepted'
        )
      )
    )
    -- Post-OWNER visibility (mirrors 066's get_profile_tagged_media)
    AND (
      prof.visibility = 'public'
      OR (viewer_id IS NOT NULL AND (
        viewer_id = p.profile_id
        OR viewer_id = target_profile_id
        OR EXISTS (
          SELECT 1 FROM follows f2
          WHERE f2.follower_id = viewer_id
          AND f2.following_id = p.profile_id
          AND f2.status = 'accepted'
        )
      ))
    )
    AND (p.status = 'published'
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_tagged_media(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid, media_limit integer DEFAULT 20, media_offset integer DEFAULT 0, filter_sport_keys text[] DEFAULT NULL::text[], filter_years integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, caption text, sport_key text, stats_data jsonb, round_id uuid, visibility text, created_at timestamp with time zone, profile_id uuid, profile_first_name text, profile_last_name text, profile_full_name text, profile_avatar_url text, media_count bigint, likes_count integer, comments_count integer, saves_count integer, tags text[], hashtags text[], is_own_post boolean, is_tagged boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id, p.caption, p.sport_key, p.stats_data, p.round_id, p.visibility,
      p.created_at, p.profile_id,
      prof.first_name AS profile_first_name, prof.last_name AS profile_last_name,
      prof.full_name AS profile_full_name, prof.avatar_url AS profile_avatar_url,
      (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
      p.likes_count, p.comments_count, COALESCE(p.saves_count, 0) AS saves_count,
      p.tags, p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      p.tags @> ARRAY[target_profile_id::TEXT]
      AND p.profile_id != target_profile_id
    )
    -- Post-level visibility (unchanged from 051)
    AND (
      p.visibility = 'public'
      OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
      OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
      OR (
        viewer_id IS NOT NULL
        AND p.visibility = 'private'
        AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = viewer_id
          AND f.following_id = p.profile_id
          AND f.status = 'accepted'
        )
      )
    )
    -- Post-OWNER visibility (the 021 hardening, finally): a private author's
    -- posts are shown only to the author, the tagged athlete, or the
    -- author's accepted followers.
    AND (
      prof.visibility = 'public'
      OR (viewer_id IS NOT NULL AND (
        viewer_id = p.profile_id
        OR viewer_id = target_profile_id
        OR EXISTS (
          SELECT 1 FROM follows f2
          WHERE f2.follower_id = viewer_id
          AND f2.following_id = p.profile_id
          AND f2.status = 'accepted'
        )
      ))
    )
    AND (p.status = 'published'
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_tagged_summary(target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(times_tagged bigint, tagger_count bigint, sport_keys text[], years integer[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT p.id) AS times_tagged,
    COUNT(DISTINCT p.profile_id) AS tagger_count,
    COALESCE(array_agg(DISTINCT p.sport_key) FILTER (WHERE p.sport_key IS NOT NULL), '{}') AS sport_keys,
    COALESCE(array_agg(DISTINCT EXTRACT(YEAR FROM p.created_at)::INT) FILTER (WHERE p.id IS NOT NULL), '{}') AS years
  FROM posts p
  INNER JOIN profiles prof ON p.profile_id = prof.id
  WHERE (
    p.tags @> ARRAY[target_profile_id::TEXT]
    AND p.profile_id != target_profile_id
  )
  AND (
    p.visibility = 'public'
    OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
    OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
    OR (
      viewer_id IS NOT NULL
      AND p.visibility = 'private'
      AND EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = viewer_id
        AND f.following_id = p.profile_id
        AND f.status = 'accepted'
      )
    )
  )
  AND (
    prof.visibility = 'public'
    OR (viewer_id IS NOT NULL AND (
      viewer_id = p.profile_id
      OR viewer_id = target_profile_id
      OR EXISTS (
        SELECT 1 FROM follows f2
        WHERE f2.follower_id = viewer_id
        AND f2.following_id = p.profile_id
        AND f2.status = 'accepted'
      )
    ))
  )
  AND (p.status = 'published'
       OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_tagged_posts(target_profile_id uuid, current_user_id uuid DEFAULT NULL::uuid, page_limit integer DEFAULT 20, page_offset integer DEFAULT 0)
 RETURNS TABLE(post_id uuid, tag_id uuid, tag_created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    pt.post_id,
    pt.id as tag_id,
    pt.created_at as tag_created_at
  FROM post_tags pt
  INNER JOIN posts p ON p.id = pt.post_id
  WHERE pt.tagged_profile_id = target_profile_id
    AND pt.status = 'active'
    AND (
      -- Show if post is public
      p.visibility = 'public'
      -- Or if current user is the tagged person
      OR current_user_id = target_profile_id
      -- Or if current user is the post owner
      OR current_user_id = p.profile_id
    )
  ORDER BY pt.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_unread_message_count(p_user_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT count(*)
  FROM public.conversation_participants cp
  JOIN public.messages m
    ON m.conversation_id = cp.conversation_id
  WHERE cp.profile_id = p_user_id
    AND cp.left_at IS NULL
    AND cp.held_at IS NULL              -- 131
    AND m.sender_id <> p_user_id
    AND m.deleted_at IS NULL
    AND m.created_at > GREATEST(
      COALESCE(cp.last_read_at, cp.joined_at, '-infinity'::timestamptz),
      COALESCE(cp.joined_at, '-infinity'::timestamptz)
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- The parameter is named `user_id` and so is the column, so the parameter
  -- MUST be qualified with the function name — otherwise `user_id = user_id`
  -- compares the column to itself and every row matches.
  SELECT COUNT(*)::integer
    INTO v_count
    FROM public.notifications n
   WHERE n.user_id = get_unread_notification_count.user_id
     AND n.is_read = FALSE;

  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.golf_course_location_facets(p_country_code text DEFAULT NULL::text)
 RETURNS TABLE(country text, country_code text, region text, region_code text, n bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    min(c.country) AS country,
    c.country_code,
    CASE WHEN p_country_code IS NULL THEN NULL ELSE min(c.region) END AS region,
    CASE WHEN p_country_code IS NULL THEN NULL ELSE c.region_code END AS region_code,
    count(*) AS n
  FROM golf_courses c
  WHERE c.country_code IS NOT NULL
    AND (p_country_code IS NULL OR (c.country_code = upper(p_country_code) AND c.region_code IS NOT NULL))
  GROUP BY c.country_code, CASE WHEN p_country_code IS NULL THEN NULL ELSE c.region_code END
  ORDER BY n DESC, 1, 3
$function$;

CREATE OR REPLACE FUNCTION public.golf_courses_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.club_name)), 'B') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.city)), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.region, NEW.region_code, NEW.country, NEW.country_code,
                public.place_context(NEW.place_id)))), 'D');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.grant_guardian_access(p_profile uuid, p_new_guardian uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF (
    SELECT count(*) FROM public.profile_access
    WHERE profile_id = p_profile AND role = 'guardian'
  ) >= 2 THEN
    RAISE EXCEPTION 'profile % already has the maximum of 2 guardians', p_profile;
  END IF;

  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (p_new_guardian, p_profile, 'guardian', p_actor)
  ON CONFLICT (user_id, profile_id) DO NOTHING;

  INSERT INTO public.profile_access_audit (profile_id, user_id, action, new_role, actor_id)
  VALUES (p_profile, p_new_guardian, 'granted', 'guardian', p_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_profile_access(p_profile_id uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_access
    WHERE profile_id = p_profile_id
      AND user_id = (select auth.uid())
      AND role = ANY (p_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$function$;

CREATE OR REPLACE FUNCTION public.hole_score_group_post(gps_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT gpp.group_post_id
  FROM public.golf_participant_scores gps
  JOIN public.group_post_participants gpp ON gpp.id = gps.participant_id
  WHERE gps.id = gps_id;
$function$;

CREATE OR REPLACE FUNCTION public.increment_comment_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.post_comments
  SET likes_count = likes_count + 1
  WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_post_save_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.posts
  SET saves_count = saves_count + 1
  WHERE id = NEW.post_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id uuid, user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = conv_id
      AND profile_id = user_id
      AND left_at IS NULL
      AND held_at IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_group_post_creator(gp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.group_posts
    WHERE id = gp_id AND creator_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_group_post_organizer(gp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.group_post_participants
    WHERE group_post_id = gp_id AND profile_id = auth.uid()
      AND role IN ('creator', 'organizer')
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_group_post_participant(gp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.group_post_participants
    WHERE group_post_id = gp_id AND profile_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_valid_handle(input_handle text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  clean_handle TEXT;
BEGIN
  -- Trim and lowercase
  clean_handle := LOWER(TRIM(input_handle));

  -- Check length (3-20 characters)
  IF LENGTH(clean_handle) < 3 OR LENGTH(clean_handle) > 20 THEN
    RETURN FALSE;
  END IF;

  -- Check format: letters, numbers, dots, underscores only
  -- Must start with letter or number
  IF NOT clean_handle ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$' THEN
    RETURN FALSE;
  END IF;

  -- No consecutive dots or underscores
  IF clean_handle ~ '[._]{2,}' THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_comment_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_actor_name TEXT;
        v_comment_author UUID;
      BEGIN
        -- SCHEMA-QUALIFIED post_comments table
        SELECT profile_id INTO v_comment_author FROM public.post_comments WHERE id = NEW.comment_id;
        IF v_comment_author = NEW.profile_id THEN RETURN NEW; END IF;

        -- SCHEMA-QUALIFIED profiles table
        SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
        INTO v_actor_name FROM public.profiles WHERE id = NEW.profile_id;

        -- SCHEMA-QUALIFIED function call
        PERFORM public.create_notification(
          p_user_id := v_comment_author,
          p_type := 'like',
          p_actor_id := NEW.profile_id,
          p_title := v_actor_name || ' liked your comment',
          p_action_url := '/feed?comment=' || NEW.comment_id,
          p_comment_id := NEW.comment_id,
          p_metadata := jsonb_build_object('comment_id', NEW.comment_id)
        );
        RETURN NEW;
      END;
      $function$;

CREATE OR REPLACE FUNCTION public.notify_follow_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    v_actor_name := public.get_actor_display_name(NEW.following_id);

    PERFORM public.create_notification(
      p_user_id := NEW.follower_id,
      p_type := 'follow_accepted',
      p_actor_id := NEW.following_id,
      p_title := v_actor_name || ' accepted your follow request',
      p_action_url := '/athlete/' || NEW.following_id,
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_follow_declined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Update the follow_request notification status when request is deleted
  IF OLD.status = 'pending' THEN
    UPDATE public.notifications
    SET action_status = 'declined',
        action_taken_at = NOW()
    WHERE follow_id = OLD.id
      AND type = 'follow_request';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_follow_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'pending' THEN
    v_actor_name := public.get_actor_display_name(NEW.follower_id);

    PERFORM public.create_notification(
      p_user_id := NEW.following_id,
      p_type := 'follow_request',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' sent you a follow request',
      p_message := NEW.message,
      p_action_url := '/app/followers?tab=requests',
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id, 'action_status', 'pending')
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_new_follower()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'accepted' THEN
    v_actor_name := public.get_actor_display_name(NEW.follower_id);

    PERFORM public.create_notification(
      p_user_id := NEW.following_id,
      p_type := 'new_follower',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' started following you',
      p_action_url := '/athlete/' || NEW.follower_id,
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_post_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_post_owner UUID;
  v_actor_name TEXT;
BEGIN
  -- Held/rejected comments are invisible: no notification until approval
  -- (the app sends it when a guardian approves).
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  SELECT profile_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
  IF v_post_owner IS NULL OR v_post_owner = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  v_actor_name := public.get_actor_display_name(NEW.profile_id);

  PERFORM public.create_notification(
    p_user_id := v_post_owner,
    p_type := 'comment',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' commented on your post',
    p_action_url := '/feed',
    p_post_id := NEW.post_id,
    p_comment_id := NEW.id,
    p_metadata := jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_post_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    DECLARE
      v_post_owner UUID;
      v_actor_name TEXT;
    BEGIN
      SELECT profile_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
      IF v_post_owner IS NULL OR v_post_owner = NEW.profile_id THEN
        RETURN NEW;
      END IF;

      v_actor_name := public.get_actor_display_name(NEW.profile_id);

      PERFORM public.create_notification(
        p_user_id := v_post_owner,
        p_type := 'like',
        p_actor_id := NEW.profile_id,
        p_title := v_actor_name || ' liked your post',
        p_action_url := '/feed',
        p_post_id := NEW.post_id,
        p_metadata := jsonb_build_object('post_id', NEW.post_id)
      );
      RETURN NEW;
    END;
    $function$;

CREATE OR REPLACE FUNCTION public.notify_profile_tagged()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_name TEXT;
BEGIN
  -- Don't notify if tagging yourself (create_notification also guards this)
  IF NEW.tagged_profile_id = NEW.created_by_profile_id THEN
    RETURN NEW;
  END IF;

  -- Actor display name, same convention as migration 014
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = NEW.created_by_profile_id;

  PERFORM public.create_notification(
    p_user_id   := NEW.tagged_profile_id,
    p_type      := 'tag',
    p_actor_id  := NEW.created_by_profile_id,
    p_title     := v_actor_name || ' tagged you in a post',
    p_action_url := '/feed?post=' || NEW.post_id,
    p_post_id   := NEW.post_id,
    p_metadata  := jsonb_build_object('tag_id', NEW.id, 'media_id', NEW.media_id)
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.organizations_kind_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'organizations.kind is immutable (% → %)', OLD.kind, NEW.kind USING ERRCODE = 'check_violation';
END;
$function$;

CREATE OR REPLACE FUNCTION public.organizations_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.description)), 'B') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.city, NEW.sport_key, NEW.location))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.region, NEW.region_code, NEW.country, NEW.country_code))), 'D') ||
    setweight(to_tsvector('simple', public.search_normalize(
      public.place_context(NEW.place_id))), 'D');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.participant_group_post(p_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT group_post_id FROM public.group_post_participants WHERE id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.place_context(p_place_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT concat_ws(' ', p.admin2, p.metro) FROM places p WHERE p.id = p_place_id
$function$;

CREATE OR REPLACE FUNCTION public.place_fields(p_place_id uuid)
 RETURNS TABLE(city text, region text, region_code text, country text, country_code text, lat double precision, lng double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT p.name, p.region, p.region_code, p.country, p.country_code, p.lat, p.lng
  FROM places p WHERE p.id = p_place_id
$function$;

CREATE OR REPLACE FUNCTION public.places_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.ascii_name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(concat_ws(' ', NEW.region, NEW.region_code))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(concat_ws(' ', NEW.country, NEW.country_code))), 'D');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.posts_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', COALESCE(NEW.caption, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.hashtags, ' '), '')), 'B');
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.profiles_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.first_name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.last_name)),  'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.full_name)),  'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.handle)),     'B') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.location))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(public.place_context(NEW.place_id))), 'D');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.provenance_inventory()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'version', 1,
      'generated_at', now(),
      'role', current_user,
      'server_version', current_setting('server_version')
    ),
    'rls', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname,
               'enabled', c.relrowsecurity,
               'forced', c.relforcerowsecurity
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', p.tablename,
               'name', p.policyname,
               'permissive', p.permissive,
               'roles', to_jsonb(p.roles),
               'cmd', p.cmd,
               'qual', p.qual,
               'with_check', p.with_check
             ) ORDER BY p.tablename, p.policyname), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
    ),
    'functions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', p.proname,
               'identity_args', pg_get_function_identity_arguments(p.oid),
               'arg_types', oidvectortypes(p.proargtypes),
               'returns', pg_get_function_result(p.oid),
               'kind', p.prokind,
               'language', l.lanname,
               'volatility', p.provolatile,
               'secdef', p.prosecdef,
               'config', to_jsonb(p.proconfig),
               'body_md5', md5(p.prosrc),
               'body_md5_norm', md5(btrim(
                 regexp_replace(
                   regexp_replace(p.prosrc, E'\r\n', E'\n', 'g'),
                   E'[ \t]+\n', E'\n', 'g'),
                 E' \t\n')),
               'body_bytes', length(p.prosrc),
               'definition', pg_get_functiondef(p.oid),
               'acl', to_jsonb(p.proacl),
               'owner', pg_get_userbyid(p.proowner)
             ) ORDER BY p.proname, oidvectortypes(p.proargtypes)), '[]'::jsonb)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language  l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass
            AND d.objid = p.oid
            AND d.deptype = 'e'
        )
    ),
    'triggers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname,
               'name', t.tgname,
               'enabled', t.tgenabled,
               'definition', pg_get_triggerdef(t.oid)
             ) ORDER BY c.relname, t.tgname), '[]'::jsonb)
      FROM pg_trigger t
      JOIN pg_class c     ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
 RETURNS TABLE(allowed boolean, retry_after_seconds integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  -- Opportunistic GC on ~1% of calls: rows are one per active key, so the
  -- table stays at hundreds of rows and this needs no cron. 2 days is
  -- comfortably past the longest window (1 day), so it only touches cold
  -- rows and never contends with a hot key's row lock.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 days';
  END IF;

  -- One atomic upsert: concurrent callers serialize on the row lock, so no
  -- lost increments and no double window-reset. While blocked, count keeps
  -- climbing but window_start does NOT move — the window still expires on
  -- schedule (no punishment-extension).
  INSERT INTO public.rate_limits AS rl (key, window_start, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN rl.window_start <= now() - make_interval(secs => p_window_seconds)
      THEN 1 ELSE rl.count + 1 END,
    window_start = CASE
      WHEN rl.window_start <= now() - make_interval(secs => p_window_seconds)
      THEN now() ELSE rl.window_start END
  RETURNING rl.count, rl.window_start INTO v_count, v_window_start;

  allowed := v_count <= p_max;
  retry_after_seconds := CASE WHEN v_count <= p_max THEN 0
    ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM
      (v_window_start + make_interval(secs => p_window_seconds) - now())))::integer)
  END;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_org_site_domain(p_slug text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT custom_domain
  FROM org_sites
  WHERE subdomain = lower(p_slug)
    AND domain_active_at IS NOT NULL
    AND published_at IS NOT NULL
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.resolve_org_site_host(p_host text)
 RETURNS TABLE(slug text, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT subdomain, domain_active_at IS NOT NULL
  FROM org_sites
  WHERE custom_domain = lower(p_host)
    AND domain_verified_at IS NOT NULL
    AND published_at IS NOT NULL
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.schema_dump()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_buckets jsonb;
  v_cron    jsonb;
  v_seed    jsonb;
  v_ledger  jsonb;
BEGIN
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', b.id, 'name', b.name, 'public', b.public,
             'file_size_limit', b.file_size_limit, 'allowed_mime_types', to_jsonb(b.allowed_mime_types)
           ) ORDER BY b.id), '[]'::jsonb)
      INTO v_buckets
      FROM storage.buckets b;
  EXCEPTION WHEN OTHERS THEN
    v_buckets := NULL;
  END;

  -- The cron commands carry a live bearer token (059 / 135 were run with
  -- CRON_SECRET pasted in): REDACTED here, so the secret never leaves the
  -- database — the rebuild carries the placeholder the files carry.
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
             'command', regexp_replace(j.command, 'Bearer [^''"\s]+', 'Bearer __CRON_SECRET__', 'g')
           ) ORDER BY j.jobname), '[]'::jsonb)
      INTO v_cron
      FROM cron.job j;
  EXCEPTION WHEN OTHERS THEN
    v_cron := NULL;
  END;

  -- Reference rows the app cannot run without. ONE table today:
  -- reserved_handles (the root-segment + system-path seed, 006 onward).
  -- `sports` is empty on prod (the registry lives in code); the golf
  -- catalog is DATA (28k courses), copied separately, never a baseline.
  BEGIN
    SELECT jsonb_build_object(
             'reserved_handles', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.handle), '[]'::jsonb) FROM public.reserved_handles r)
           )
      INTO v_seed;
  EXCEPTION WHEN OTHERS THEN
    v_seed := NULL;
  END;

  BEGIN
    SELECT jsonb_build_object('head', max(m.number), 'rows', count(*))
      INTO v_ledger
      FROM public.schema_migrations m;
  EXCEPTION WHEN OTHERS THEN
    v_ledger := NULL;
  END;

  RETURN jsonb_build_object(
    'meta', jsonb_build_object(
      'version', 3,
      'generated_at', now(),
      'role', current_user,
      'server_version', current_setting('server_version'),
      'ledger', v_ledger
    ),
    'extensions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', e.extname, 'schema', n.nspname, 'version', e.extversion) ORDER BY e.extname), '[]'::jsonb)
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname <> 'plpgsql'
    ),
    'types', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', t.typname,
               'labels', (SELECT jsonb_agg(l.enumlabel ORDER BY l.enumsortorder) FROM pg_enum l WHERE l.enumtypid = t.oid)
             ) ORDER BY t.typname), '[]'::jsonb)
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    ),
    'sequences', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', s.sequencename, 'data_type', s.data_type::text,
               'start', s.start_value, 'increment', s.increment_by, 'min', s.min_value, 'max', s.max_value, 'cycle', s.cycle,
               'owned_by', (
                 SELECT c.relname || '.' || a.attname
                 FROM pg_depend d
                 JOIN pg_class c ON c.oid = d.refobjid
                 JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                 WHERE d.classid = 'pg_class'::regclass AND d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass
                   AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
                 LIMIT 1
               ),
               'identity', EXISTS (
                 SELECT 1 FROM pg_depend d
                 WHERE d.classid = 'pg_class'::regclass AND d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass
                   AND d.deptype = 'i'
               ),
               'grants', jsonb_build_object(
                 'anon', has_sequence_privilege('anon', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE'),
                 'authenticated', has_sequence_privilege('authenticated', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE'),
                 'service_role', has_sequence_privilege('service_role', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE')
               )
             ) ORDER BY s.sequencename), '[]'::jsonb)
      FROM pg_sequences s
      WHERE s.schemaname = 'public'
    ),
    'tables', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', c.relname,
               'kind', c.relkind,
               'rls', c.relrowsecurity,
               'rls_forced', c.relforcerowsecurity,
               'comment', obj_description(c.oid, 'pg_class'),
               'columns', (
                 SELECT jsonb_agg(jsonb_build_object(
                          'name', a.attname,
                          'type', format_type(a.atttypid, a.atttypmod),
                          'not_null', a.attnotnull,
                          'default', pg_get_expr(d.adbin, d.adrelid),
                          'identity', a.attidentity,
                          'generated', a.attgenerated,
                          'comment', col_description(c.oid, a.attnum)
                        ) ORDER BY a.attnum)
                 FROM pg_attribute a
                 LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                 WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
               ),
               'grants', (
                 -- has_table_privilege per role × privilege: visible whoever calls
                 -- (role_table_grants showed only the CALLER's grants — 228).
                 SELECT COALESCE(jsonb_object_agg(g.grantee, g.privs), '{}'::jsonb)
                 FROM (
                   SELECT r.grantee,
                          (SELECT jsonb_agg(p.priv ORDER BY p.priv)
                             FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) AS p(priv)
                            WHERE has_table_privilege(r.grantee, c.oid, p.priv)) AS privs
                   FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(grantee)
                 ) g
                 WHERE g.privs IS NOT NULL
               )
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'constraints', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname, 'name', k.conname, 'type', k.contype,
               'definition', pg_get_constraintdef(k.oid),
               'index', (SELECT i.relname FROM pg_class i WHERE i.oid = k.conindid AND k.conindid <> 0)
             ) ORDER BY c.relname, k.contype, k.conname), '[]'::jsonb)
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'indexes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', i.tablename, 'name', i.indexname, 'definition', i.indexdef,
               'constraint', EXISTS (
                 SELECT 1 FROM pg_constraint k WHERE k.conindid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass
               )
             ) ORDER BY i.tablename, i.indexname), '[]'::jsonb)
      FROM pg_indexes i
      WHERE i.schemaname = 'public'
    ),
    'views', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', c.relname, 'materialized', c.relkind = 'm',
               'definition', pg_get_viewdef(c.oid, true),
               -- 234: the view's reloptions (security_invoker, check_option …) — pg_get_viewdef
               -- never carries them, and a rebuilt view without them is a different view.
               'options', to_jsonb(c.reloptions),
               'grants', (
                 -- has_table_privilege per role × privilege: visible whoever calls
                 -- (role_table_grants showed only the CALLER's grants — 228).
                 SELECT COALESCE(jsonb_object_agg(g.grantee, g.privs), '{}'::jsonb)
                 FROM (
                   SELECT r.grantee,
                          (SELECT jsonb_agg(p.priv ORDER BY p.priv)
                             FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) AS p(priv)
                            WHERE has_table_privilege(r.grantee, c.oid, p.priv)) AS privs
                   FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(grantee)
                 ) g
                 WHERE g.privs IS NOT NULL
               )
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ),
    'functions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', p.proname,
               'identity_args', pg_get_function_identity_arguments(p.oid),
               'kind', p.prokind,
               'language', l.lanname,
               'definition', pg_get_functiondef(p.oid),
               'grants', jsonb_build_object(
                 'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
                 'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                 'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')
               ),
               'comment', obj_description(p.oid, 'pg_proc')
             ) ORDER BY p.proname, oidvectortypes(p.proargtypes)), '[]'::jsonb)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language  l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    ),
    'triggers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schema', n.nspname, 'table', c.relname, 'name', t.tgname,
               'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid)
             ) ORDER BY n.nspname, c.relname, t.tgname), '[]'::jsonb)
      FROM pg_trigger t
      JOIN pg_class c     ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
        AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schema', p.schemaname, 'table', p.tablename, 'name', p.policyname,
               'permissive', p.permissive, 'roles', to_jsonb(p.roles), 'cmd', p.cmd,
               'qual', p.qual, 'with_check', p.with_check
             ) ORDER BY p.schemaname, p.tablename, p.policyname), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public' OR (p.schemaname = 'storage' AND p.tablename = 'objects')
    ),
    'publications', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('publication', pt.pubname, 'table', pt.tablename) ORDER BY pt.pubname, pt.tablename), '[]'::jsonb)
      FROM pg_publication_tables pt
      WHERE pt.schemaname = 'public'
    ),
    'storage_buckets', v_buckets,
    'cron_jobs', v_cron,
    'seed_rows', v_seed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_all(q text, p_types text[] DEFAULT NULL::text[], max_per_type integer DEFAULT 20, visible_ids uuid[] DEFAULT '{}'::uuid[], include_public boolean DEFAULT true, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text, p_near_lat double precision DEFAULT NULL::double precision, p_near_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS TABLE(entity_type text, entity_id uuid, title text, subtitle text, sport_key text, city text, region text, region_code text, country text, country_code text, place_id uuid, lat double precision, lng double precision, distance_km double precision, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn       text    := public.search_normalize(q);
  tsq      tsquery := public.search_prefix_tsquery(q);
  per      int     := GREATEST(COALESCE(max_per_type, 20), 1);
  near     boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius   float8  := COALESCE(p_radius_km, 50);
  filtered boolean;
  dlat     float8;
  dlng     float8;
BEGIN
  filtered := p_country_code IS NOT NULL OR p_region_code IS NOT NULL OR near;
  -- An empty query is a filtered browse or nothing (search_people precedent).
  IF qn = '' AND NOT filtered THEN RETURN; END IF;
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  WITH base AS (
    SELECT d.*,
      CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, d.lat, d.lng) END AS dist
    FROM search_documents d
    WHERE (p_types IS NULL OR d.entity_type = ANY(p_types))
      -- Privacy: public docs pass (athletes only when include_public);
      -- everything else needs the owner in the caller's audience.
      AND ( (d.visibility = 'public' AND (d.entity_type <> 'athlete' OR include_public))
            OR (d.owner_id IS NOT NULL AND d.owner_id = ANY(visible_ids)) )
      AND (p_country_code IS NULL OR d.country_code = upper(p_country_code))
      AND (p_region_code IS NULL OR d.region_code = upper(p_region_code))
      AND (NOT near OR (d.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                    AND d.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
  ),
  matched AS (
    SELECT b.*,
      CASE
        WHEN qn = '' THEN 3
        WHEN public.search_normalize(b.title) = qn THEN 0
        WHEN public.search_normalize(b.title) LIKE qn || '%' THEN 1
        WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(b.title)) @@ tsq THEN 2
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq THEN 3
        ELSE 4
      END AS tier,
      CASE WHEN tsq IS NOT NULL
           THEN public.search_token_hits(to_tsvector('simple', public.search_normalize(b.title)), q)
           ELSE 0 END AS name_hits,
      CASE WHEN tsq IS NOT NULL THEN public.search_token_rank(b.search_vector, q) ELSE 0 END AS score
    FROM base b
    WHERE qn = ''
       OR (tsq IS NOT NULL AND b.search_vector @@ tsq)
       OR (length(qn) >= 2 AND (
            b.title ILIKE '%' || qn || '%' OR b.subtitle ILIKE '%' || qn || '%'
         OR b.city ILIKE '%' || qn || '%' OR b.region ILIKE '%' || qn || '%'
         OR b.country ILIKE '%' || qn || '%'))
  ),
  ranked AS (
    SELECT m.*, ROW_NUMBER() OVER (
      PARTITION BY m.entity_type
      ORDER BY
        m.tier,
        CASE WHEN near AND qn = '' THEN m.dist END ASC NULLS LAST,
        m.name_hits DESC,
        m.rich DESC,
        m.recency DESC NULLS LAST,
        m.score DESC,
        m.dist ASC NULLS LAST,
        m.title
    ) AS rn
    FROM matched m
  )
  SELECT r.entity_type, r.entity_id, r.title, r.subtitle, r.sport_key,
    r.city, r.region, r.region_code, r.country, r.country_code,
    r.place_id, r.lat, r.lng, r.dist, r.tier
  FROM ranked r
  WHERE r.rn <= per
  ORDER BY
    r.tier,
    CASE WHEN near AND qn = '' THEN r.dist END ASC NULLS LAST,
    r.name_hits DESC,
    r.rich DESC,
    r.recency DESC NULLS LAST,
    r.score DESC,
    r.dist ASC NULLS LAST,
    r.title;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_all_facets(q text, p_types text[] DEFAULT NULL::text[], visible_ids uuid[] DEFAULT '{}'::uuid[], include_public boolean DEFAULT true, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text)
 RETURNS TABLE(facet text, code text, label text, n bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn  text    := public.search_normalize(q);
  tsq tsquery := public.search_prefix_tsquery(q);
BEGIN
  RETURN QUERY
  WITH matched AS (
    SELECT d.*
    FROM search_documents d
    WHERE (p_types IS NULL OR d.entity_type = ANY(p_types))
      AND ( (d.visibility = 'public' AND (d.entity_type <> 'athlete' OR include_public))
            OR (d.owner_id IS NOT NULL AND d.owner_id = ANY(visible_ids)) )
      AND (p_country_code IS NULL OR d.country_code = upper(p_country_code))
      AND (p_region_code IS NULL OR d.region_code = upper(p_region_code))
      AND (qn = ''
        OR (tsq IS NOT NULL AND d.search_vector @@ tsq)
        OR (length(qn) >= 2 AND (
             d.title ILIKE '%' || qn || '%' OR d.subtitle ILIKE '%' || qn || '%'
          OR d.city ILIKE '%' || qn || '%' OR d.region ILIKE '%' || qn || '%'
          OR d.country ILIKE '%' || qn || '%')))
  ),
  grouped AS (
    SELECT
      CASE
        WHEN GROUPING(m.entity_type) = 0 THEN 'type'
        WHEN GROUPING(m.sport_key) = 0 THEN 'sport'
        WHEN GROUPING(m.region_code) = 0 THEN 'region'
        ELSE 'country'
      END AS g_facet,
      CASE
        WHEN GROUPING(m.entity_type) = 0 THEN m.entity_type
        WHEN GROUPING(m.sport_key) = 0 THEN m.sport_key
        WHEN GROUPING(m.region_code) = 0 THEN m.region_code
        ELSE m.country_code
      END AS g_code,
      CASE
        WHEN GROUPING(m.entity_type) = 0 THEN m.entity_type
        WHEN GROUPING(m.sport_key) = 0 THEN m.sport_key
        WHEN GROUPING(m.region_code) = 0 THEN min(m.region)
        ELSE min(m.country)
      END AS g_label,
      count(*) AS g_n
    FROM matched m
    GROUP BY GROUPING SETS ((m.entity_type), (m.sport_key), (m.country_code, m.region_code), (m.country_code))
  ),
  ranked AS (
    SELECT g.g_facet, g.g_code, g.g_label, g.g_n,
      ROW_NUMBER() OVER (PARTITION BY g.g_facet ORDER BY g.g_n DESC, g.g_code) AS rn
    FROM grouped g
    WHERE g.g_code IS NOT NULL
  )
  SELECT r.g_facet, r.g_code, r.g_label, r.g_n
  FROM ranked r
  WHERE r.rn <= 100
  ORDER BY
    CASE r.g_facet WHEN 'type' THEN 0 WHEN 'sport' THEN 1 WHEN 'country' THEN 2 ELSE 3 END,
    r.g_n DESC,
    r.g_code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_by_handle(search_term text, max_results integer DEFAULT 10)
 RETURNS TABLE(profile_id uuid, handle text, first_name text, last_name text, avatar_url text, sport text, school text, match_type text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  clean_term TEXT;
BEGIN
  -- Remove @ if present and clean
  clean_term := LOWER(TRIM(LEADING '@' FROM TRIM(search_term)));

  RETURN QUERY
  SELECT
    p.id,
    p.handle,
    p.first_name,
    p.last_name,
    p.avatar_url,
    p.sport,
    p.school,
    CASE
      WHEN LOWER(p.handle) = clean_term THEN 'exact'
      WHEN LOWER(p.handle) LIKE clean_term || '%' THEN 'prefix'
      ELSE 'partial'
    END AS match_type
  FROM public.profiles p
  WHERE p.handle IS NOT NULL
    AND LOWER(p.handle) LIKE '%' || clean_term || '%'
  ORDER BY
    -- Exact matches first
    CASE WHEN LOWER(p.handle) = clean_term THEN 0 ELSE 1 END,
    -- Then prefix matches
    CASE WHEN LOWER(p.handle) LIKE clean_term || '%' THEN 0 ELSE 1 END,
    -- Then by length (shorter handles rank higher)
    LENGTH(p.handle),
    -- Finally alphabetically
    p.handle
  LIMIT max_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_clubs(q text, max_results integer DEFAULT 20, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text, p_near_lat double precision DEFAULT NULL::double precision, p_near_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, name text, description text, location text, city text, region text, region_code text, country text, country_code text, lat double precision, lng double precision, distance_km double precision, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn     text    := public.search_normalize(q);
  tsq    tsquery := public.search_prefix_tsquery(q);
  lim    int     := GREATEST(COALESCE(max_results, 20), 1);
  near   boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius float8  := COALESCE(p_radius_km, 50);
  dlat   float8;
  dlng   float8;
BEGIN
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  SELECT c.id, c.name, c.description, c.location,
    c.city, c.region, c.region_code, c.country, c.country_code, c.lat, c.lng,
    CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END AS distance_km,
    CASE
      WHEN qn = '' THEN 3
      WHEN public.search_normalize(c.name) = qn THEN 0
      WHEN public.search_normalize(c.name) LIKE qn || '%' THEN 1
      WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(c.name)) @@ tsq THEN 2
      ELSE 3
    END AS match_rank
  FROM public.organizations c
  WHERE c.kind = 'club'
    AND (p_country_code IS NULL OR c.country_code = upper(p_country_code))
    AND (p_region_code IS NULL OR c.region_code = upper(p_region_code))
    AND (NOT near OR (c.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                  AND c.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
    AND (qn = '' OR (tsq IS NOT NULL AND c.search_vector @@ tsq)
         OR (length(qn) >= 2 AND (c.name ILIKE '%' || qn || '%' OR c.location ILIKE '%' || qn || '%')))
  ORDER BY 13,
    CASE WHEN near AND qn = '' THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END ASC NULLS LAST,
    CASE WHEN tsq IS NOT NULL THEN public.search_token_hits(to_tsvector('simple', public.search_normalize(c.name)), q) ELSE 0 END DESC,
    c.name
  LIMIT lim;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_doc_delete_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  DELETE FROM search_documents sd
  WHERE sd.entity_type = OLD.kind AND sd.entity_id = OLD.id;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_doc_sync_athlete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t text := COALESCE(NULLIF(btrim(COALESCE(NEW.full_name, '')), ''), NEW.handle);
BEGIN
  IF t IS NULL THEN
    DELETE FROM search_documents sd WHERE sd.entity_type = 'athlete' AND sd.entity_id = NEW.id;
    RETURN NULL;
  END IF;
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES ('athlete', NEW.id, t, NEW.handle, NULL,
    NEW.id, COALESCE(NEW.visibility, 'public'), NEW.place_id, NEW.city, NEW.region, NEW.region_code,
    NEW.country, NEW.country_code, NEW.lat, NEW.lng,
    (NEW.handle IS NOT NULL AND NEW.avatar_url IS NOT NULL),
    NEW.updated_at, COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_doc_sync_course()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES ('course', NEW.id, NEW.name, NEW.club_name, 'golf',
    NULL, 'public', NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code,
    NEW.lat, NEW.lng,
    (NEW.hole_data IS NOT NULL OR NEW.course_rating <> '{}'::jsonb),
    NEW.hydrated_at, COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_doc_sync_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES (NEW.kind, NEW.id, NEW.name, left(NEW.description, 140), NEW.sport_key,
    NULL, 'public', NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code,
    NEW.lat, NEW.lng, (NEW.description IS NOT NULL), NEW.updated_at,
    COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_doc_sync_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t text;
  author text;
BEGIN
  IF NEW.visibility = 'public' AND NEW.status = 'published' THEN
    t := left(btrim(COALESCE(NEW.caption, '')), 140);
    IF t = '' THEN
      t := left(btrim(array_to_string(COALESCE(NEW.hashtags, '{}'), ' ')), 140);
    END IF;
    IF t = '' THEN
      -- Nothing searchable: no caption, no hashtags.
      DELETE FROM search_documents sd WHERE sd.entity_type = 'post' AND sd.entity_id = NEW.id;
      RETURN NULL;
    END IF;
    SELECT p.full_name INTO author FROM profiles p WHERE p.id = NEW.profile_id;
    INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
      owner_id, visibility, place_id, city, region, region_code, country, country_code,
      lat, lng, rich, recency, search_vector)
    VALUES ('post', NEW.id, t, author, NEW.sport_key,
      NEW.profile_id, 'public', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      false, NEW.created_at,
      setweight(to_tsvector('simple', public.search_normalize(NEW.caption)), 'A') ||
      setweight(to_tsvector('simple', public.search_normalize(array_to_string(COALESCE(NEW.hashtags, '{}'), ' '))), 'B') ||
      setweight(to_tsvector('simple', public.search_normalize(NEW.sport_key)), 'C'))
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
      owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility,
      rich = EXCLUDED.rich, recency = EXCLUDED.recency,
      search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  ELSE
    DELETE FROM search_documents sd WHERE sd.entity_type = 'post' AND sd.entity_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_document_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  DELETE FROM search_documents sd
  WHERE sd.entity_type = TG_ARGV[0] AND sd.entity_id = OLD.id;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_golf_courses(q text, max_results integer DEFAULT 20, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text, p_near_lat double precision DEFAULT NULL::double precision, p_near_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, external_source text, external_id text, name text, club_name text, city text, region text, country text, total_par integer, holes_count integer, hole_data jsonb, course_rating jsonb, slope_rating jsonb, lat double precision, lng double precision, description text, description_attribution text, architect text, year_built integer, course_type text, website text, phone text, hydrated_at timestamp with time zone, place_id uuid, country_code text, region_code text, location_source text, distance_km double precision, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn     text    := public.search_normalize(q);
  tsq    tsquery := public.search_prefix_tsquery(q);
  lim    int     := GREATEST(COALESCE(max_results, 20), 1);
  near   boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius float8  := COALESCE(p_radius_km, 50);
  dlat   float8;
  dlng   float8;
BEGIN
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  WITH base AS (
    SELECT c.*,
      CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END AS dist
    FROM golf_courses c
    WHERE (p_country_code IS NULL OR c.country_code = upper(p_country_code))
      AND (p_region_code IS NULL OR c.region_code = upper(p_region_code))
      AND (NOT near OR (c.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                    AND c.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
  ),
  matched AS (
    SELECT b.*,
      CASE
        WHEN qn = '' THEN 3
        WHEN public.search_normalize(b.name) = qn THEN 0
        WHEN public.search_normalize(b.name) LIKE qn || '%' THEN 1
        WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(b.name)) @@ tsq THEN 2
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq THEN 3
        ELSE 4
      END AS tier,
      CASE WHEN tsq IS NOT NULL
           THEN public.search_token_hits(to_tsvector('simple', public.search_normalize(b.name)), q)
           ELSE 0 END AS name_hits,
      CASE WHEN tsq IS NOT NULL THEN public.search_token_rank(b.search_vector, q) ELSE 0 END AS score
    FROM base b
    WHERE qn = ''
       OR (tsq IS NOT NULL AND b.search_vector @@ tsq)
       OR (length(qn) >= 2 AND (
            b.name ILIKE '%' || qn || '%' OR b.club_name ILIKE '%' || qn || '%'
         OR b.city ILIKE '%' || qn || '%' OR b.region ILIKE '%' || qn || '%'
         OR b.country ILIKE '%' || qn || '%'))
  )
  SELECT m.id, m.external_source, m.external_id, m.name, m.club_name,
    m.city, m.region, m.country, m.total_par, m.holes_count,
    m.hole_data, m.course_rating, m.slope_rating,
    m.lat, m.lng, m.description, m.description_attribution,
    m.architect, m.year_built, m.course_type, m.website, m.phone,
    m.hydrated_at, m.place_id, m.country_code, m.region_code,
    m.location_source, m.dist, m.tier
  FROM matched m
  ORDER BY
    m.tier,
    CASE WHEN near AND qn = '' THEN m.dist END ASC NULLS LAST,
    -- More of the query in the NAME wins, whatever sits next to what.
    m.name_hits DESC,
    (m.hole_data IS NOT NULL OR m.course_rating <> '{}'::jsonb) DESC,
    (m.city IS NOT NULL) DESC,
    m.hydrated_at DESC NULLS LAST,
    m.score DESC,
    m.dist ASC NULLS LAST,
    m.name
  LIMIT lim;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_normalize(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$ SELECT lower(unaccent(coalesce(t, ''))) $function$;

CREATE OR REPLACE FUNCTION public.search_people(search_term text, visible_ids uuid[] DEFAULT '{}'::uuid[], include_public boolean DEFAULT true, max_results integer DEFAULT 20, require_handle boolean DEFAULT false, exclude_id uuid DEFAULT NULL::uuid, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text, p_near_lat double precision DEFAULT NULL::double precision, p_near_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, handle text, first_name text, middle_name text, last_name text, full_name text, avatar_url text, location text, sport text, school text, visibility text, city text, region text, region_code text, country text, country_code text, distance_km double precision, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  q        TEXT;
  q_c      TEXT;
  v_lo     TEXT;
  v_hi     TEXT;
  esc      TEXT;
  infix    TEXT;
  wordpre  TEXT;
  is_short BOOLEAN;
  tsq      TSQUERY;
  near     BOOLEAN := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius   FLOAT8  := COALESCE(p_radius_km, 50);
  filtered BOOLEAN := p_country_code IS NOT NULL OR p_region_code IS NOT NULL
                      OR (p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL);
  dlat     FLOAT8;
  dlng     FLOAT8;
BEGIN
  q := lower(btrim(ltrim(btrim(COALESCE(search_term, '')), '@')));
  -- An empty query is allowed ONLY as a filtered browse (Explore: "athletes
  -- in Ontario"); unfiltered it returns nothing, as in 087.
  IF q = '' AND NOT filtered THEN
    RETURN;
  END IF;

  q_c  := q COLLATE "C";
  v_lo := q_c;
  v_hi := (q || chr(1114111)) COLLATE "C";
  esc     := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  infix   := '%' || esc || '%';
  wordpre := '% ' || esc || '%';
  is_short := length(q) < 3;
  tsq  := public.search_prefix_tsquery(q);
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));

  RETURN QUERY
  SELECT
    p.id, p.handle, p.first_name, p.middle_name, p.last_name, p.full_name,
    p.avatar_url, p.location, p.sport, p.school, p.visibility,
    p.city, p.region, p.region_code, p.country, p.country_code,
    CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, p.lat, p.lng) END AS distance_km,
    (CASE
       WHEN q = ''                                                    THEN 5
       WHEN (lower(p.handle) COLLATE "C") = q_c                       THEN 0
       WHEN (lower(p.handle) COLLATE "C") >= v_lo
        AND (lower(p.handle) COLLATE "C") <  v_hi                     THEN 1
       WHEN ((lower(p.first_name) COLLATE "C") >= v_lo AND (lower(p.first_name) COLLATE "C") < v_hi)
         OR ((lower(p.last_name)  COLLATE "C") >= v_lo AND (lower(p.last_name)  COLLATE "C") < v_hi)
         OR ((lower(p.full_name)  COLLATE "C") >= v_lo AND (lower(p.full_name)  COLLATE "C") < v_hi)
                                                                      THEN 2
       WHEN lower(p.full_name)  LIKE wordpre
         OR lower(p.last_name)  LIKE wordpre
         OR lower(p.first_name) LIKE wordpre                          THEN 3
       WHEN NOT is_short AND (
            lower(p.handle)     LIKE infix OR lower(p.first_name) LIKE infix OR
            lower(p.last_name)  LIKE infix OR lower(p.full_name)  LIKE infix) THEN 4
       -- Location tier: every token of the query matches somewhere in the
       -- profile's vector (city, region, country, free-text location, or a
       -- name token mixed in: "sarah ottawa"). Always below name tiers.
       ELSE 5
     END)::INT AS match_rank
  FROM public.profiles p
  WHERE
    ((include_public AND p.visibility = 'public') OR p.id = ANY(visible_ids))
    AND (NOT require_handle OR p.handle IS NOT NULL)
    AND (exclude_id IS NULL OR p.id <> exclude_id)
    AND (p_country_code IS NULL OR p.country_code = upper(p_country_code))
    AND (p_region_code IS NULL OR p.region_code = upper(p_region_code))
    AND (NOT near OR (p.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                  AND p.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
    AND (
      q = '' OR
      ((lower(p.handle)     COLLATE "C") >= v_lo AND (lower(p.handle)     COLLATE "C") < v_hi) OR
      ((lower(p.first_name) COLLATE "C") >= v_lo AND (lower(p.first_name) COLLATE "C") < v_hi) OR
      ((lower(p.last_name)  COLLATE "C") >= v_lo AND (lower(p.last_name)  COLLATE "C") < v_hi) OR
      ((lower(p.full_name)  COLLATE "C") >= v_lo AND (lower(p.full_name)  COLLATE "C") < v_hi) OR
      (NOT is_short AND (
        lower(p.handle)     LIKE infix OR
        lower(p.first_name) LIKE infix OR
        lower(p.last_name)  LIKE infix OR
        lower(p.full_name)  LIKE infix
      )) OR
      (tsq IS NOT NULL AND p.search_vector @@ tsq)
    )
  ORDER BY
    match_rank,
    CASE WHEN near AND q = '' THEN public.haversine_km(p_near_lat, p_near_lng, p.lat, p.lng) END ASC NULLS LAST,
    length(COALESCE(p.full_name, p.handle, '')),
    COALESCE(p.full_name, p.handle, ''),
    p.id
  LIMIT GREATEST(COALESCE(max_results, 20), 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_places(q text, max_results integer DEFAULT 10, p_country_code text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, region text, region_code text, country text, country_code text, lat double precision, lng double precision, population integer, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn  text := public.search_normalize(q);
  tsq tsquery := public.search_prefix_tsquery(q);
  lim int := GREATEST(COALESCE(max_results, 10), 1);
BEGIN
  IF tsq IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.region, p.region_code, p.country, p.country_code, p.lat, p.lng, p.population,
    CASE WHEN public.search_normalize(p.name) = qn THEN 0
         WHEN public.search_normalize(p.name) LIKE qn || '%' THEN 1
         WHEN EXISTS (SELECT 1 FROM place_aliases a WHERE a.geonames_id = p.geonames_id AND a.alias_norm LIKE qn || '%') THEN 2
         ELSE 3 END AS match_rank
  FROM places p
  WHERE (p.search_vector @@ tsq
         OR EXISTS (SELECT 1 FROM place_aliases a WHERE a.geonames_id = p.geonames_id AND a.alias_norm LIKE qn || '%'))
    AND (p_country_code IS NULL OR p.country_code = upper(p_country_code))
  ORDER BY 10, p.population DESC NULLS LAST, p.name
  LIMIT lim;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_posts(search_query text, max_results integer DEFAULT 15)
 RETURNS TABLE(id uuid, caption text, sport_key text, created_at timestamp with time zone, profile_id uuid, rank real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY SELECT
    po.id, po.caption, po.sport_key, po.created_at, po.profile_id,
    ts_rank(po.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.posts po
  WHERE po.visibility = 'public'
  AND po.status = 'published'
  AND po.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, po.created_at DESC
  LIMIT max_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_prefix_tsquery(q text)
 RETURNS tsquery
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN cardinality(toks) = 0 THEN NULL
    ELSE to_tsquery('simple', array_to_string(ARRAY(SELECT t || ':*' FROM unnest(toks) AS t), ' & '))
  END
  FROM (
    SELECT array_remove(regexp_split_to_array(public.search_normalize(q), '[^[:alnum:]]+'), '') AS toks
  ) s
$function$;

CREATE OR REPLACE FUNCTION public.search_profiles(search_query text, max_results integer DEFAULT 20)
 RETURNS TABLE(id uuid, full_name text, first_name text, middle_name text, last_name text, avatar_url text, location text, sport text, school text, visibility text, rank real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY SELECT
    p.id,
    p.full_name,
    p.first_name,
    p.middle_name,
    p.last_name,
    p.avatar_url,
    p.location,
    p.sport,
    p.school,
    p.visibility,
    ts_rank(p.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.profiles p
  WHERE p.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, p.full_name ASC NULLS LAST
  LIMIT max_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_query_tokens(q text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT array_remove(regexp_split_to_array(public.search_normalize(q), '[^[:alnum:]]+'), '')
$function$;

CREATE OR REPLACE FUNCTION public.search_token_hits(vec tsvector, q text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT count(*)::int
  FROM unnest(public.search_query_tokens(q)) AS t
  WHERE vec @@ to_tsquery('simple', t || ':*')
$function$;

CREATE OR REPLACE FUNCTION public.search_token_rank(vec tsvector, q text)
 RETURNS real
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT COALESCE(sum(ts_rank(vec, to_tsquery('simple', t || ':*'))), 0)::real
  FROM unnest(public.search_query_tokens(q)) AS t
$function$;

CREATE OR REPLACE FUNCTION public.split_full_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Only process if full_name changed and is not null
  IF NEW.full_name IS NOT NULL AND NEW.full_name != '' THEN
    -- If first_name is empty, extract it from full_name
    IF NEW.first_name IS NULL OR NEW.first_name = '' THEN
      NEW.first_name := SPLIT_PART(TRIM(NEW.full_name), ' ', 1);
    END IF;

    -- If last_name is empty, extract it from full_name
    IF NEW.last_name IS NULL OR NEW.last_name = '' THEN
      -- Check if there are multiple words in full_name
      IF ARRAY_LENGTH(STRING_TO_ARRAY(TRIM(NEW.full_name), ' '), 1) > 1 THEN
        NEW.last_name := TRIM(SUBSTRING(
          TRIM(NEW.full_name)
          FROM POSITION(' ' IN TRIM(NEW.full_name)) + 1
        ));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_privacy_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- When visibility changes, update or create privacy_settings
  INSERT INTO public.privacy_settings (profile_id, profile_visibility)
  VALUES (NEW.id, NEW.visibility)
  ON CONFLICT (profile_id)
  DO UPDATE SET
    profile_visibility = NEW.visibility,
    updated_at = NOW();

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_connection_suggestions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE conversations SET updated_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_equipment_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_follows_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_group_post_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_post_comments_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_post_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post_id := OLD.post_id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE public.posts
  SET comments_count = (
    SELECT COUNT(*) FROM public.post_comments
    WHERE post_id = target_post_id AND status = 'published'
  )
  WHERE id = target_post_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_post_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_post_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post_id := OLD.post_id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE public.posts
  SET likes_count = (
    SELECT COUNT(*) FROM public.post_likes WHERE post_id = target_post_id
  )
  WHERE id = target_post_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_post_reposts_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  old_target UUID;
  new_target UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_target := NEW.shared_post_id;
  ELSIF TG_OP = 'DELETE' THEN
    old_target := OLD.shared_post_id;
  ELSE -- UPDATE OF shared_post_id
    IF OLD.shared_post_id IS DISTINCT FROM NEW.shared_post_id THEN
      old_target := OLD.shared_post_id;
      new_target := NEW.shared_post_id;
    END IF;
  END IF;

  IF old_target IS NOT NULL THEN
    UPDATE public.posts
    SET reposts_count = (
      SELECT COUNT(*) FROM public.posts WHERE shared_post_id = old_target
    )
    WHERE id = old_target;
  END IF;

  IF new_target IS NOT NULL THEN
    UPDATE public.posts
    SET reposts_count = (
      SELECT COUNT(*) FROM public.posts WHERE shared_post_id = new_target
    )
    WHERE id = new_target;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_post_tags_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Unconditional stamp, as migration 008 intended. Do NOT reintroduce a
  -- column guard here: this function is attached to post_tags, and guarding on
  -- a column that table does not have is the entire bug being fixed.
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_handle(p_profile_id uuid, p_new_handle text)
 RETURNS TABLE(success boolean, message text, new_handle text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  current_handle TEXT;
  profile_exists BOOLEAN;
  clean_new_handle TEXT;
  last_change TIMESTAMP WITH TIME ZONE;
  change_count INT;
  availability_result RECORD;
  jwt_role TEXT;
BEGIN
  SELECT TRUE, handle, handle_updated_at, handle_change_count
  INTO profile_exists, current_handle, last_change, change_count
  FROM public.profiles
  WHERE id = p_profile_id;

  IF profile_exists IS NOT TRUE THEN
    RETURN QUERY SELECT FALSE, 'Profile not found', NULL::TEXT;
    RETURN;
  END IF;

  clean_new_handle := LOWER(TRIM(p_new_handle));

  IF current_handle IS NULL THEN
    jwt_role := COALESCE(
      current_setting('request.jwt.claims', true)::jsonb->>'role', '');
    IF NOT (jwt_role = 'service_role'
            OR p_profile_id = auth.uid()
            OR public.has_profile_access(p_profile_id, ARRAY['owner','guardian'])) THEN
      RETURN QUERY SELECT FALSE, 'Not permitted to set this handle', NULL::TEXT;
      RETURN;
    END IF;
    SELECT * INTO availability_result
    FROM public.check_handle_availability(clean_new_handle, p_profile_id);
    IF NOT availability_result.available THEN
      RETURN QUERY SELECT FALSE, availability_result.reason, NULL::TEXT;
      RETURN;
    END IF;
    UPDATE public.profiles
    SET handle = p_new_handle, handle_updated_at = NOW(),
        handle_change_count = COALESCE(change_count, 0)
    WHERE id = p_profile_id;
    RETURN QUERY SELECT TRUE, 'Handle set successfully!', p_new_handle;
    RETURN;
  END IF;

  IF LOWER(current_handle) = clean_new_handle THEN
    UPDATE public.profiles SET handle = p_new_handle WHERE id = p_profile_id;
    RETURN QUERY SELECT TRUE, 'Handle casing updated', p_new_handle;
    RETURN;
  END IF;

  IF last_change IS NOT NULL AND last_change > NOW() - INTERVAL '7 days' THEN
    RETURN QUERY SELECT
      FALSE,
      'You can only change your handle once per week. Next available: ' ||
        TO_CHAR(last_change + INTERVAL '7 days', 'Mon DD, YYYY'),
      NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO availability_result
  FROM public.check_handle_availability(clean_new_handle, p_profile_id);
  IF NOT availability_result.available THEN
    RETURN QUERY SELECT FALSE, availability_result.reason, NULL::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.handle_history (profile_id, old_handle, new_handle)
  VALUES (p_profile_id, current_handle, clean_new_handle);

  UPDATE public.profiles
  SET handle = p_new_handle,
      handle_updated_at = NOW(),
      handle_change_count = COALESCE(change_count, 0) + 1
  WHERE id = p_profile_id;

  RETURN QUERY SELECT
    TRUE,
    'Handle updated successfully! Old @mentions will redirect for 30 days.',
    p_new_handle;
END;
$function$;

-- ── Triggers ──────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS affiliations_updated_at ON public.affiliations;
CREATE TRIGGER affiliations_updated_at BEFORE UPDATE ON public.affiliations FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS set_athlete_achievements_updated_at ON public.athlete_achievements;
CREATE TRIGGER set_athlete_achievements_updated_at BEFORE UPDATE ON public.athlete_achievements FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS trigger_equipment_updated_at ON public.athlete_equipment;
CREATE TRIGGER trigger_equipment_updated_at BEFORE UPDATE ON public.athlete_equipment FOR EACH ROW EXECUTE FUNCTION update_equipment_updated_at();
DROP TRIGGER IF EXISTS athlete_performances_updated_at ON public.athlete_performances;
CREATE TRIGGER athlete_performances_updated_at BEFORE UPDATE ON public.athlete_performances FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS trigger_decrement_comment_likes_count ON public.comment_likes;
CREATE TRIGGER trigger_decrement_comment_likes_count AFTER DELETE ON public.comment_likes FOR EACH ROW EXECUTE FUNCTION decrement_comment_likes_count();
DROP TRIGGER IF EXISTS trigger_increment_comment_likes_count ON public.comment_likes;
CREATE TRIGGER trigger_increment_comment_likes_count AFTER INSERT ON public.comment_likes FOR EACH ROW EXECUTE FUNCTION increment_comment_likes_count();
DROP TRIGGER IF EXISTS trigger_notify_comment_like ON public.comment_likes;
CREATE TRIGGER trigger_notify_comment_like AFTER INSERT ON public.comment_likes FOR EACH ROW EXECUTE FUNCTION notify_comment_like();
DROP TRIGGER IF EXISTS competition_entries_updated_at ON public.competition_entries;
CREATE TRIGGER competition_entries_updated_at BEFORE UPDATE ON public.competition_entries FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS competitions_updated_at ON public.competitions;
CREATE TRIGGER competitions_updated_at BEFORE UPDATE ON public.competitions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS trigger_connection_suggestions_updated_at ON public.connection_suggestions;
CREATE TRIGGER trigger_connection_suggestions_updated_at BEFORE UPDATE ON public.connection_suggestions FOR EACH ROW EXECUTE FUNCTION update_connection_suggestions_updated_at();
DROP TRIGGER IF EXISTS consent_records_immutable ON public.consent_records;
CREATE TRIGGER consent_records_immutable BEFORE DELETE OR UPDATE ON public.consent_records FOR EACH ROW EXECUTE FUNCTION consent_records_forbid_mutation();
DROP TRIGGER IF EXISTS contest_media_updated_at ON public.contest_media;
CREATE TRIGGER contest_media_updated_at BEFORE UPDATE ON public.contest_media FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS contest_media_tags_updated_at ON public.contest_media_tags;
CREATE TRIGGER contest_media_tags_updated_at BEFORE UPDATE ON public.contest_media_tags FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS contest_results_updated_at ON public.contest_results;
CREATE TRIGGER contest_results_updated_at BEFORE UPDATE ON public.contest_results FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS contest_stat_lines_updated_at ON public.contest_stat_lines;
CREATE TRIGGER contest_stat_lines_updated_at BEFORE UPDATE ON public.contest_stat_lines FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS contests_updated_at ON public.contests;
CREATE TRIGGER contests_updated_at BEFORE UPDATE ON public.contests FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS handle_updated_at_carpool_offers ON public.event_carpool_offers;
CREATE TRIGGER handle_updated_at_carpool_offers BEFORE UPDATE ON public.event_carpool_offers FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at_event_series ON public.event_series;
CREATE TRIGGER handle_updated_at_event_series BEFORE UPDATE ON public.event_series FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at_events ON public.events;
CREATE TRIGGER handle_updated_at_events BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS follows_counts_sync ON public.follows;
CREATE TRIGGER follows_counts_sync AFTER INSERT OR DELETE OR UPDATE ON public.follows FOR EACH ROW EXECUTE FUNCTION follows_counts_sync();
DROP TRIGGER IF EXISTS set_follows_updated_at ON public.follows;
CREATE TRIGGER set_follows_updated_at BEFORE UPDATE ON public.follows FOR EACH ROW EXECUTE FUNCTION update_follows_updated_at();
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON public.follows;
CREATE TRIGGER trigger_notify_follow_accepted AFTER UPDATE ON public.follows FOR EACH ROW EXECUTE FUNCTION notify_follow_accepted();
DROP TRIGGER IF EXISTS trigger_notify_follow_declined ON public.follows;
CREATE TRIGGER trigger_notify_follow_declined BEFORE DELETE ON public.follows FOR EACH ROW WHEN ((old.status = 'pending'::text)) EXECUTE FUNCTION notify_follow_declined();
DROP TRIGGER IF EXISTS trigger_notify_follow_request ON public.follows;
CREATE TRIGGER trigger_notify_follow_request AFTER INSERT ON public.follows FOR EACH ROW EXECUTE FUNCTION notify_follow_request();
DROP TRIGGER IF EXISTS trigger_notify_new_follower ON public.follows;
CREATE TRIGGER trigger_notify_new_follower AFTER INSERT ON public.follows FOR EACH ROW WHEN ((new.status = 'accepted'::text)) EXECUTE FUNCTION notify_new_follower();
DROP TRIGGER IF EXISTS golf_clubs_updated_at ON public.golf_clubs;
CREATE TRIGGER golf_clubs_updated_at BEFORE UPDATE ON public.golf_clubs FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS golf_courses_search_doc ON public.golf_courses;
CREATE TRIGGER golf_courses_search_doc AFTER INSERT OR UPDATE OF name, club_name, city, region, region_code, country, country_code, place_id, lat, lng, hole_data, course_rating, hydrated_at, search_vector ON public.golf_courses FOR EACH ROW EXECUTE FUNCTION search_doc_sync_course();
DROP TRIGGER IF EXISTS golf_courses_search_doc_delete ON public.golf_courses;
CREATE TRIGGER golf_courses_search_doc_delete AFTER DELETE ON public.golf_courses FOR EACH ROW EXECUTE FUNCTION search_document_delete('course');
DROP TRIGGER IF EXISTS golf_courses_search_vector ON public.golf_courses;
CREATE TRIGGER golf_courses_search_vector BEFORE INSERT OR UPDATE OF name, club_name, city, region, region_code, country, country_code, place_id ON public.golf_courses FOR EACH ROW EXECUTE FUNCTION golf_courses_search_vector_update();
DROP TRIGGER IF EXISTS handle_updated_at_golf_courses ON public.golf_courses;
CREATE TRIGGER handle_updated_at_golf_courses BEFORE UPDATE ON public.golf_courses FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS trigger_bump_hole_score_version ON public.golf_hole_scores;
CREATE TRIGGER trigger_bump_hole_score_version BEFORE UPDATE ON public.golf_hole_scores FOR EACH ROW EXECUTE FUNCTION bump_hole_score_version();
DROP TRIGGER IF EXISTS trigger_calculate_golf_totals_delete ON public.golf_hole_scores;
CREATE TRIGGER trigger_calculate_golf_totals_delete AFTER DELETE ON public.golf_hole_scores FOR EACH ROW EXECUTE FUNCTION calculate_golf_participant_totals();
DROP TRIGGER IF EXISTS trigger_calculate_golf_totals_insert ON public.golf_hole_scores;
CREATE TRIGGER trigger_calculate_golf_totals_insert AFTER INSERT ON public.golf_hole_scores FOR EACH ROW EXECUTE FUNCTION calculate_golf_participant_totals();
DROP TRIGGER IF EXISTS trigger_calculate_golf_totals_update ON public.golf_hole_scores;
CREATE TRIGGER trigger_calculate_golf_totals_update AFTER UPDATE ON public.golf_hole_scores FOR EACH ROW EXECUTE FUNCTION calculate_golf_participant_totals();
DROP TRIGGER IF EXISTS trigger_update_hole_scores_timestamp ON public.golf_hole_scores;
CREATE TRIGGER trigger_update_hole_scores_timestamp BEFORE UPDATE ON public.golf_hole_scores FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();
DROP TRIGGER IF EXISTS trigger_update_golf_scores_timestamp ON public.golf_participant_scores;
CREATE TRIGGER trigger_update_golf_scores_timestamp BEFORE UPDATE ON public.golf_participant_scores FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();
DROP TRIGGER IF EXISTS trigger_update_golf_data_timestamp ON public.golf_scorecard_data;
CREATE TRIGGER trigger_update_golf_data_timestamp BEFORE UPDATE ON public.golf_scorecard_data FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();
DROP TRIGGER IF EXISTS trigger_update_participant_timestamp ON public.group_post_participants;
CREATE TRIGGER trigger_update_participant_timestamp BEFORE UPDATE ON public.group_post_participants FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();
DROP TRIGGER IF EXISTS trigger_update_group_post_timestamp ON public.group_posts;
CREATE TRIGGER trigger_update_group_post_timestamp BEFORE UPDATE ON public.group_posts FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();
DROP TRIGGER IF EXISTS help_articles_updated_at ON public.help_articles;
CREATE TRIGGER help_articles_updated_at BEFORE UPDATE ON public.help_articles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS trg_update_conv_on_msg ON public.messages;
CREATE TRIGGER trg_update_conv_on_msg AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();
DROP TRIGGER IF EXISTS update_messages_updated_at ON public.messages;
CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_notifications_updated_at ON public.notifications;
CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS org_requests_updated_at ON public.org_requests;
CREATE TRIGGER org_requests_updated_at BEFORE UPDATE ON public.org_requests FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS org_site_modules_updated_at ON public.org_site_modules;
CREATE TRIGGER org_site_modules_updated_at BEFORE UPDATE ON public.org_site_modules FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS org_site_news_updated_at ON public.org_site_news;
CREATE TRIGGER org_site_news_updated_at BEFORE UPDATE ON public.org_site_news FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS org_site_pages_updated_at ON public.org_site_pages;
CREATE TRIGGER org_site_pages_updated_at BEFORE UPDATE ON public.org_site_pages FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS org_site_revisions_updated_at ON public.org_site_revisions;
CREATE TRIGGER org_site_revisions_updated_at BEFORE UPDATE ON public.org_site_revisions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS org_sites_updated_at ON public.org_sites;
CREATE TRIGGER org_sites_updated_at BEFORE UPDATE ON public.org_sites FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS org_staff_audit_immutable ON public.org_staff_audit;
CREATE TRIGGER org_staff_audit_immutable BEFORE DELETE OR UPDATE ON public.org_staff_audit FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS organizations_kind_immutable ON public.organizations;
CREATE TRIGGER organizations_kind_immutable BEFORE UPDATE OF kind ON public.organizations FOR EACH ROW WHEN ((old.kind IS DISTINCT FROM new.kind)) EXECUTE FUNCTION organizations_kind_immutable();
DROP TRIGGER IF EXISTS organizations_search_doc ON public.organizations;
CREATE TRIGGER organizations_search_doc AFTER INSERT OR UPDATE OF name, description, sport_key, location, city, region, region_code, country, country_code, place_id, lat, lng, search_vector ON public.organizations FOR EACH ROW EXECUTE FUNCTION search_doc_sync_org();
DROP TRIGGER IF EXISTS organizations_search_doc_delete ON public.organizations;
CREATE TRIGGER organizations_search_doc_delete AFTER DELETE ON public.organizations FOR EACH ROW EXECUTE FUNCTION search_doc_delete_org();
DROP TRIGGER IF EXISTS organizations_search_vector ON public.organizations;
CREATE TRIGGER organizations_search_vector BEFORE INSERT OR UPDATE OF name, description, sport_key, location, city, region, region_code, country, country_code, place_id ON public.organizations FOR EACH ROW EXECUTE FUNCTION organizations_search_vector_update();
DROP TRIGGER IF EXISTS organizations_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at_performances ON public.performances;
CREATE TRIGGER handle_updated_at_performances BEFORE UPDATE ON public.performances FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS places_search_vector ON public.places;
CREATE TRIGGER places_search_vector BEFORE INSERT OR UPDATE OF name, ascii_name, region, region_code, country, country_code ON public.places FOR EACH ROW EXECUTE FUNCTION places_search_vector_update();
DROP TRIGGER IF EXISTS trigger_notify_post_comment ON public.post_comments;
CREATE TRIGGER trigger_notify_post_comment AFTER INSERT ON public.post_comments FOR EACH ROW EXECUTE FUNCTION notify_post_comment();
DROP TRIGGER IF EXISTS trigger_update_post_comments_count ON public.post_comments;
CREATE TRIGGER trigger_update_post_comments_count AFTER INSERT OR DELETE OR UPDATE OF status ON public.post_comments FOR EACH ROW EXECUTE FUNCTION update_post_comments_count();
DROP TRIGGER IF EXISTS trigger_notify_post_like ON public.post_likes;
CREATE TRIGGER trigger_notify_post_like AFTER INSERT ON public.post_likes FOR EACH ROW EXECUTE FUNCTION notify_post_like();
DROP TRIGGER IF EXISTS trigger_update_post_likes_count ON public.post_likes;
CREATE TRIGGER trigger_update_post_likes_count AFTER INSERT OR DELETE ON public.post_likes FOR EACH ROW EXECUTE FUNCTION update_post_likes_count();
DROP TRIGGER IF EXISTS trigger_notify_profile_tagged ON public.post_tags;
CREATE TRIGGER trigger_notify_profile_tagged AFTER INSERT ON public.post_tags FOR EACH ROW WHEN ((new.status = 'active'::text)) EXECUTE FUNCTION notify_profile_tagged();
DROP TRIGGER IF EXISTS trigger_update_post_tags_timestamp ON public.post_tags;
CREATE TRIGGER trigger_update_post_tags_timestamp BEFORE UPDATE ON public.post_tags FOR EACH ROW EXECUTE FUNCTION update_post_tags_updated_at();
DROP TRIGGER IF EXISTS posts_search_doc ON public.posts;
CREATE TRIGGER posts_search_doc AFTER INSERT OR UPDATE OF caption, hashtags, sport_key, visibility, status ON public.posts FOR EACH ROW EXECUTE FUNCTION search_doc_sync_post();
DROP TRIGGER IF EXISTS posts_search_doc_delete ON public.posts;
CREATE TRIGGER posts_search_doc_delete AFTER DELETE ON public.posts FOR EACH ROW EXECUTE FUNCTION search_document_delete('post');
DROP TRIGGER IF EXISTS posts_search_vector_trigger ON public.posts;
CREATE TRIGGER posts_search_vector_trigger BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();
DROP TRIGGER IF EXISTS trigger_update_post_reposts_count ON public.posts;
CREATE TRIGGER trigger_update_post_reposts_count AFTER INSERT OR DELETE OR UPDATE OF shared_post_id ON public.posts FOR EACH ROW EXECUTE FUNCTION update_post_reposts_count();
DROP TRIGGER IF EXISTS update_posts_updated_at ON public.posts;
CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS profile_access_guardian_cap ON public.profile_access;
CREATE CONSTRAINT TRIGGER profile_access_guardian_cap AFTER INSERT OR UPDATE OF role ON public.profile_access NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION enforce_guardian_cap();
DROP TRIGGER IF EXISTS profile_access_last_guardian ON public.profile_access;
CREATE CONSTRAINT TRIGGER profile_access_last_guardian AFTER DELETE OR UPDATE OF role ON public.profile_access DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_last_guardian();
DROP TRIGGER IF EXISTS profile_access_nonempty ON public.profile_access;
CREATE CONSTRAINT TRIGGER profile_access_nonempty AFTER DELETE OR UPDATE OF profile_id, role ON public.profile_access DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_profile_has_access();
DROP TRIGGER IF EXISTS profile_access_audit_immutable ON public.profile_access_audit;
CREATE TRIGGER profile_access_audit_immutable BEFORE DELETE OR UPDATE ON public.profile_access_audit FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS handle_updated_at_profile_transfers ON public.profile_transfers;
CREATE TRIGGER handle_updated_at_profile_transfers BEFORE UPDATE ON public.profile_transfers FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS auto_split_full_name ON public.profiles;
CREATE TRIGGER auto_split_full_name BEFORE INSERT OR UPDATE OF full_name ON public.profiles FOR EACH ROW EXECUTE FUNCTION split_full_name();
DROP TRIGGER IF EXISTS handle_updated_at_profiles ON public.profiles;
CREATE TRIGGER handle_updated_at_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS profiles_search_doc ON public.profiles;
CREATE TRIGGER profiles_search_doc AFTER INSERT OR UPDATE OF first_name, last_name, full_name, handle, location, city, region, region_code, country, country_code, place_id, lat, lng, visibility, avatar_url, search_vector ON public.profiles FOR EACH ROW EXECUTE FUNCTION search_doc_sync_athlete();
DROP TRIGGER IF EXISTS profiles_search_doc_delete ON public.profiles;
CREATE TRIGGER profiles_search_doc_delete AFTER DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION search_document_delete('athlete');
DROP TRIGGER IF EXISTS profiles_search_vector ON public.profiles;
CREATE TRIGGER profiles_search_vector BEFORE INSERT OR UPDATE OF first_name, last_name, full_name, handle, location, city, region, region_code, country, country_code, place_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_search_vector_update();
DROP TRIGGER IF EXISTS sync_profile_privacy ON public.profiles;
CREATE TRIGGER sync_profile_privacy AFTER INSERT OR UPDATE OF visibility ON public.profiles FOR EACH ROW EXECUTE FUNCTION sync_privacy_settings();
DROP TRIGGER IF EXISTS trigger_auto_update_display_name ON public.profiles;
CREATE TRIGGER trigger_auto_update_display_name BEFORE INSERT OR UPDATE OF first_name, middle_name, last_name, full_name, username ON public.profiles FOR EACH ROW EXECUTE FUNCTION auto_update_display_name();
DROP TRIGGER IF EXISTS registrations_updated_at ON public.registrations;
CREATE TRIGGER registrations_updated_at BEFORE UPDATE ON public.registrations FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS safety_settings_audit_immutable ON public.safety_settings_audit;
CREATE TRIGGER safety_settings_audit_immutable BEFORE DELETE OR UPDATE ON public.safety_settings_audit FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS trigger_decrement_post_save_count ON public.saved_posts;
CREATE TRIGGER trigger_decrement_post_save_count AFTER DELETE ON public.saved_posts FOR EACH ROW EXECUTE FUNCTION decrement_post_save_count();
DROP TRIGGER IF EXISTS trigger_increment_post_save_count ON public.saved_posts;
CREATE TRIGGER trigger_increment_post_save_count AFTER INSERT ON public.saved_posts FOR EACH ROW EXECUTE FUNCTION increment_post_save_count();
DROP TRIGGER IF EXISTS handle_updated_at_season_highlights ON public.season_highlights;
CREATE TRIGGER handle_updated_at_season_highlights BEFORE UPDATE ON public.season_highlights FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS seasons_updated_at ON public.seasons;
CREATE TRIGGER seasons_updated_at BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS sport_event_groups_updated_at ON public.sport_event_groups;
CREATE TRIGGER sport_event_groups_updated_at BEFORE UPDATE ON public.sport_event_groups FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS sport_event_matches_updated_at ON public.sport_event_matches;
CREATE TRIGGER sport_event_matches_updated_at BEFORE UPDATE ON public.sport_event_matches FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS sport_event_participants_updated_at ON public.sport_event_participants;
CREATE TRIGGER sport_event_participants_updated_at BEFORE UPDATE ON public.sport_event_participants FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS sport_event_rounds_updated_at ON public.sport_event_rounds;
CREATE TRIGGER sport_event_rounds_updated_at BEFORE UPDATE ON public.sport_event_rounds FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS sport_event_stat_lines_updated_at ON public.sport_event_stat_lines;
CREATE TRIGGER sport_event_stat_lines_updated_at BEFORE UPDATE ON public.sport_event_stat_lines FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS sport_events_updated_at ON public.sport_events;
CREATE TRIGGER sport_events_updated_at BEFORE UPDATE ON public.sport_events FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at_sport_settings ON public.sport_settings;
CREATE TRIGGER handle_updated_at_sport_settings BEFORE UPDATE ON public.sport_settings FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at_sports ON public.sports;
CREATE TRIGGER handle_updated_at_sports BEFORE UPDATE ON public.sports FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS teams_updated_at ON public.teams;
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS tickets_updated_at ON public.tickets;
CREATE TRIGGER tickets_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS user_media_presets_updated_at ON public.user_media_presets;
CREATE TRIGGER user_media_presets_updated_at BEFORE UPDATE ON public.user_media_presets FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS venues_updated_at ON public.venues;
CREATE TRIGGER venues_updated_at BEFORE UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS set_workout_routines_updated_at ON public.workout_routines;
CREATE TRIGGER set_workout_routines_updated_at BEFORE UPDATE ON public.workout_routines FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS set_workout_sessions_updated_at ON public.workout_sessions;
CREATE TRIGGER set_workout_sessions_updated_at BEFORE UPDATE ON public.workout_sessions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── Row level security ────────────────────────────────────────────────────────
ALTER TABLE public.affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approved_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_claim_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_performances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_feed_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_entry_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_media_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_stat_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_carpool_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_carpool_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golf_clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golf_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golf_hole_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golf_holes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golf_participant_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golf_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golf_scorecard_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_post_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handle_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_claim_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_site_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_site_hit_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_site_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_site_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_site_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_site_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_site_stats_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_staff_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reserved_handles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_settings_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sanction_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_shortlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_event_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_event_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_event_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_event_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_event_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_event_stat_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_media_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_mutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_routine_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sets ENABLE ROW LEVEL SECURITY;

-- ── Policies (179) ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS achievements_delete_policy ON public.athlete_achievements;
CREATE POLICY achievements_delete_policy ON public.athlete_achievements
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS achievements_insert_policy ON public.athlete_achievements;
CREATE POLICY achievements_insert_policy ON public.athlete_achievements
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS achievements_select_policy ON public.athlete_achievements;
CREATE POLICY achievements_select_policy ON public.athlete_achievements
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = athlete_achievements.profile_id) AND (p.visibility = 'public'::text))))));
DROP POLICY IF EXISTS achievements_update_policy ON public.athlete_achievements;
CREATE POLICY achievements_update_policy ON public.athlete_achievements
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS athlete_achievements_guardian_write ON public.athlete_achievements;
CREATE POLICY athlete_achievements_guardian_write ON public.athlete_achievements
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
  WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS athlete_achievements_profile_access_select ON public.athlete_achievements;
CREATE POLICY athlete_achievements_profile_access_select ON public.athlete_achievements
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS athlete_equipment_guardian_write ON public.athlete_equipment;
CREATE POLICY athlete_equipment_guardian_write ON public.athlete_equipment
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
  WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS athlete_equipment_profile_access_select ON public.athlete_equipment;
CREATE POLICY athlete_equipment_profile_access_select ON public.athlete_equipment
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS equipment_delete_policy ON public.athlete_equipment;
CREATE POLICY equipment_delete_policy ON public.athlete_equipment
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = auth.uid()));
DROP POLICY IF EXISTS equipment_insert_policy ON public.athlete_equipment;
CREATE POLICY equipment_insert_policy ON public.athlete_equipment
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = auth.uid()));
DROP POLICY IF EXISTS equipment_select_policy ON public.athlete_equipment;
CREATE POLICY equipment_select_policy ON public.athlete_equipment
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = athlete_equipment.profile_id) AND (p.visibility = 'public'::text))))));
DROP POLICY IF EXISTS equipment_update_policy ON public.athlete_equipment;
CREATE POLICY equipment_update_policy ON public.athlete_equipment
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = auth.uid()));
DROP POLICY IF EXISTS "Athletes can insert own vitals" ON public.athlete_vitals;
CREATE POLICY "Athletes can insert own vitals" ON public.athlete_vitals
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Athletes can view own vitals" ON public.athlete_vitals;
CREATE POLICY "Athletes can view own vitals" ON public.athlete_vitals
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = athlete_vitals.profile_id) AND (p.visibility = 'public'::text))))));
DROP POLICY IF EXISTS athlete_vitals_guardian_write ON public.athlete_vitals;
CREATE POLICY athlete_vitals_guardian_write ON public.athlete_vitals
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
  WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS athlete_vitals_profile_access_select ON public.athlete_vitals;
CREATE POLICY athlete_vitals_profile_access_select ON public.athlete_vitals
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS comment_likes_delete_policy ON public.comment_likes;
CREATE POLICY comment_likes_delete_policy ON public.comment_likes
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS comment_likes_insert_policy ON public.comment_likes;
CREATE POLICY comment_likes_insert_policy ON public.comment_likes
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS comment_likes_select_policy ON public.comment_likes;
CREATE POLICY comment_likes_select_policy ON public.comment_likes
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS connection_suggestions_delete_policy ON public.connection_suggestions;
CREATE POLICY connection_suggestions_delete_policy ON public.connection_suggestions
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS connection_suggestions_insert_policy ON public.connection_suggestions;
CREATE POLICY connection_suggestions_insert_policy ON public.connection_suggestions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS connection_suggestions_select_policy ON public.connection_suggestions;
CREATE POLICY connection_suggestions_select_policy ON public.connection_suggestions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS connection_suggestions_update_policy ON public.connection_suggestions;
CREATE POLICY connection_suggestions_update_policy ON public.connection_suggestions
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Participants can view participant list" ON public.conversation_participants;
CREATE POLICY "Participants can view participant list" ON public.conversation_participants
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Users can update own participant row" ON public.conversation_participants;
CREATE POLICY "Users can update own participant row" ON public.conversation_participants
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Participants can update group settings" ON public.conversations;
CREATE POLICY "Participants can update group settings" ON public.conversations
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (is_conversation_participant(id, ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Participants can view conversations" ON public.conversations;
CREATE POLICY "Participants can view conversations" ON public.conversations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (is_conversation_participant(id, ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS carpool_claims_select ON public.event_carpool_claims;
CREATE POLICY carpool_claims_select ON public.event_carpool_claims
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM (event_carpool_offers o
     JOIN event_guests g ON ((g.event_id = o.event_id)))
  WHERE ((o.id = event_carpool_claims.offer_id) AND (g.profile_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS carpool_offers_select ON public.event_carpool_offers;
CREATE POLICY carpool_offers_select ON public.event_carpool_offers
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM event_guests g
  WHERE ((g.event_id = event_carpool_offers.event_id) AND (g.profile_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS "Facilities are viewable by everyone" ON public.facilities;
CREATE POLICY "Facilities are viewable by everyone" ON public.facilities
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS follows_delete_policy ON public.follows;
CREATE POLICY follows_delete_policy ON public.follows
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((follower_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS follows_insert_policy ON public.follows;
CREATE POLICY follows_insert_policy ON public.follows
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((follower_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS follows_select_policy ON public.follows;
CREATE POLICY follows_select_policy ON public.follows
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((follower_id = ( SELECT auth.uid() AS uid)) OR (following_id = ( SELECT auth.uid() AS uid))));
DROP POLICY IF EXISTS follows_update_policy ON public.follows;
CREATE POLICY follows_update_policy ON public.follows
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((following_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Golf clubs are viewable by everyone" ON public.golf_clubs;
CREATE POLICY "Golf clubs are viewable by everyone" ON public.golf_clubs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "Golf courses are viewable by everyone" ON public.golf_courses;
CREATE POLICY "Golf courses are viewable by everyone" ON public.golf_courses
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS hole_scores_delete_policy ON public.golf_hole_scores;
CREATE POLICY hole_scores_delete_policy ON public.golf_hole_scores
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM ((golf_participant_scores gps
     JOIN group_post_participants gpp ON ((gps.participant_id = gpp.id)))
     JOIN group_posts gp ON ((gpp.group_post_id = gp.id)))
  WHERE ((gps.id = golf_hole_scores.golf_participant_id) AND ((gpp.profile_id = ( SELECT auth.uid() AS uid)) OR (gp.creator_id = ( SELECT auth.uid() AS uid)))))));
DROP POLICY IF EXISTS hole_scores_insert_policy ON public.golf_hole_scores;
CREATE POLICY hole_scores_insert_policy ON public.golf_hole_scores
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM ((golf_participant_scores gps
     JOIN group_post_participants gpp ON ((gps.participant_id = gpp.id)))
     JOIN group_posts gp ON ((gpp.group_post_id = gp.id)))
  WHERE ((gps.id = golf_hole_scores.golf_participant_id) AND ((gpp.profile_id = ( SELECT auth.uid() AS uid)) OR (gp.creator_id = ( SELECT auth.uid() AS uid)))))));
DROP POLICY IF EXISTS hole_scores_select_policy ON public.golf_hole_scores;
CREATE POLICY hole_scores_select_policy ON public.golf_hole_scores
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (can_view_group_post(hole_score_group_post(golf_participant_id)));
DROP POLICY IF EXISTS hole_scores_update_policy ON public.golf_hole_scores;
CREATE POLICY hole_scores_update_policy ON public.golf_hole_scores
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM ((golf_participant_scores gps
     JOIN group_post_participants gpp ON ((gps.participant_id = gpp.id)))
     JOIN group_posts gp ON ((gpp.group_post_id = gp.id)))
  WHERE ((gps.id = golf_hole_scores.golf_participant_id) AND ((gpp.profile_id = ( SELECT auth.uid() AS uid)) OR (gp.creator_id = ( SELECT auth.uid() AS uid)))))));
DROP POLICY IF EXISTS golf_holes_delete_policy ON public.golf_holes;
CREATE POLICY golf_holes_delete_policy ON public.golf_holes
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM golf_rounds
  WHERE ((golf_rounds.id = golf_holes.round_id) AND (golf_rounds.profile_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS golf_holes_insert_policy ON public.golf_holes;
CREATE POLICY golf_holes_insert_policy ON public.golf_holes
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM golf_rounds
  WHERE ((golf_rounds.id = golf_holes.round_id) AND (golf_rounds.profile_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS golf_holes_profile_access_select ON public.golf_holes;
CREATE POLICY golf_holes_profile_access_select ON public.golf_holes
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM golf_rounds r
  WHERE ((r.id = golf_holes.round_id) AND has_profile_access(r.profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])))));
DROP POLICY IF EXISTS golf_holes_select_policy ON public.golf_holes;
CREATE POLICY golf_holes_select_policy ON public.golf_holes
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM golf_rounds
  WHERE ((golf_rounds.id = golf_holes.round_id) AND ((golf_rounds.profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM profiles
          WHERE ((profiles.id = golf_rounds.profile_id) AND ((profiles.visibility = 'public'::text) OR (EXISTS ( SELECT 1
                   FROM follows
                  WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = golf_rounds.profile_id) AND (follows.status = 'accepted'::text)))))))))))));
DROP POLICY IF EXISTS golf_holes_update_policy ON public.golf_holes;
CREATE POLICY golf_holes_update_policy ON public.golf_holes
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM golf_rounds
  WHERE ((golf_rounds.id = golf_holes.round_id) AND (golf_rounds.profile_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS golf_scores_insert_policy ON public.golf_participant_scores;
CREATE POLICY golf_scores_insert_policy ON public.golf_participant_scores
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) = entered_by) AND (EXISTS ( SELECT 1
   FROM (group_post_participants gpp
     JOIN group_posts gp ON ((gpp.group_post_id = gp.id)))
  WHERE ((gpp.id = golf_participant_scores.participant_id) AND ((gpp.profile_id = ( SELECT auth.uid() AS uid)) OR (gp.creator_id = ( SELECT auth.uid() AS uid))))))));
DROP POLICY IF EXISTS golf_scores_select_policy ON public.golf_participant_scores;
CREATE POLICY golf_scores_select_policy ON public.golf_participant_scores
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (can_view_group_post(participant_group_post(participant_id)));
DROP POLICY IF EXISTS golf_scores_update_policy ON public.golf_participant_scores;
CREATE POLICY golf_scores_update_policy ON public.golf_participant_scores
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM group_post_participants gpp
  WHERE ((gpp.id = golf_participant_scores.participant_id) AND ((gpp.profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM group_posts
          WHERE ((group_posts.id = gpp.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid))))))))));
DROP POLICY IF EXISTS golf_rounds_delete_policy ON public.golf_rounds;
CREATE POLICY golf_rounds_delete_policy ON public.golf_rounds
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS golf_rounds_guardian_write ON public.golf_rounds;
CREATE POLICY golf_rounds_guardian_write ON public.golf_rounds
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
  WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS golf_rounds_insert_policy ON public.golf_rounds;
CREATE POLICY golf_rounds_insert_policy ON public.golf_rounds
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS golf_rounds_profile_access_select ON public.golf_rounds;
CREATE POLICY golf_rounds_profile_access_select ON public.golf_rounds
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS golf_rounds_select_policy ON public.golf_rounds;
CREATE POLICY golf_rounds_select_policy ON public.golf_rounds
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = golf_rounds.profile_id) AND ((profiles.visibility = 'public'::text) OR (EXISTS ( SELECT 1
           FROM follows
          WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = golf_rounds.profile_id) AND (follows.status = 'accepted'::text))))))))));
DROP POLICY IF EXISTS golf_rounds_update_policy ON public.golf_rounds;
CREATE POLICY golf_rounds_update_policy ON public.golf_rounds
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS golf_data_insert_policy ON public.golf_scorecard_data;
CREATE POLICY golf_data_insert_policy ON public.golf_scorecard_data
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM group_posts
  WHERE ((group_posts.id = golf_scorecard_data.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS golf_data_select_policy ON public.golf_scorecard_data;
CREATE POLICY golf_data_select_policy ON public.golf_scorecard_data
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM group_posts
  WHERE ((group_posts.id = golf_scorecard_data.group_post_id) AND ((group_posts.creator_id = ( SELECT auth.uid() AS uid)) OR (group_posts.visibility = 'public'::text) OR (EXISTS ( SELECT 1
           FROM group_post_participants
          WHERE ((group_post_participants.group_post_id = golf_scorecard_data.group_post_id) AND (group_post_participants.profile_id = ( SELECT auth.uid() AS uid))))))))));
DROP POLICY IF EXISTS golf_data_update_policy ON public.golf_scorecard_data;
CREATE POLICY golf_data_update_policy ON public.golf_scorecard_data
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM group_posts
  WHERE ((group_posts.id = golf_scorecard_data.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS group_post_media_delete_policy ON public.group_post_media;
CREATE POLICY group_post_media_delete_policy ON public.group_post_media
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((( SELECT auth.uid() AS uid) = uploaded_by) OR (EXISTS ( SELECT 1
   FROM group_posts
  WHERE ((group_posts.id = group_post_media.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid)))))));
DROP POLICY IF EXISTS group_post_media_insert_policy ON public.group_post_media;
CREATE POLICY group_post_media_insert_policy ON public.group_post_media
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) = uploaded_by) AND (EXISTS ( SELECT 1
   FROM group_post_participants
  WHERE ((group_post_participants.group_post_id = group_post_media.group_post_id) AND (group_post_participants.profile_id = ( SELECT auth.uid() AS uid)) AND (group_post_participants.status = 'confirmed'::text))))));
DROP POLICY IF EXISTS group_post_media_select_policy ON public.group_post_media;
CREATE POLICY group_post_media_select_policy ON public.group_post_media
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM group_post_participants
  WHERE ((group_post_participants.group_post_id = group_post_media.group_post_id) AND (group_post_participants.profile_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM group_posts
  WHERE ((group_posts.id = group_post_media.group_post_id) AND ((group_posts.creator_id = ( SELECT auth.uid() AS uid)) OR (group_posts.visibility = 'public'::text)))))));
DROP POLICY IF EXISTS media_delete_policy ON public.group_post_media;
CREATE POLICY media_delete_policy ON public.group_post_media
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((( SELECT auth.uid() AS uid) = uploaded_by) OR (EXISTS ( SELECT 1
   FROM group_posts
  WHERE ((group_posts.id = group_post_media.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid)))))));
DROP POLICY IF EXISTS media_insert_policy ON public.group_post_media;
CREATE POLICY media_insert_policy ON public.group_post_media
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) = uploaded_by) AND (EXISTS ( SELECT 1
   FROM group_post_participants
  WHERE ((group_post_participants.group_post_id = group_post_media.group_post_id) AND (group_post_participants.profile_id = ( SELECT auth.uid() AS uid)) AND (group_post_participants.status = 'confirmed'::text))))));
DROP POLICY IF EXISTS media_select_policy ON public.group_post_media;
CREATE POLICY media_select_policy ON public.group_post_media
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((EXISTS ( SELECT 1
   FROM group_post_participants
  WHERE ((group_post_participants.group_post_id = group_post_media.group_post_id) AND (group_post_participants.profile_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM group_posts
  WHERE ((group_posts.id = group_post_media.group_post_id) AND ((group_posts.creator_id = ( SELECT auth.uid() AS uid)) OR (group_posts.visibility = 'public'::text)))))));
DROP POLICY IF EXISTS media_update_policy ON public.group_post_media;
CREATE POLICY media_update_policy ON public.group_post_media
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((( SELECT auth.uid() AS uid) = uploaded_by) OR (EXISTS ( SELECT 1
   FROM group_posts
  WHERE ((group_posts.id = group_post_media.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid)))))))
  WITH CHECK (((( SELECT auth.uid() AS uid) = uploaded_by) OR (EXISTS ( SELECT 1
   FROM group_posts
  WHERE ((group_posts.id = group_post_media.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid)))))));
DROP POLICY IF EXISTS participants_delete_policy ON public.group_post_participants;
CREATE POLICY participants_delete_policy ON public.group_post_participants
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((is_group_post_creator(group_post_id) OR is_group_post_organizer(group_post_id)));
DROP POLICY IF EXISTS participants_insert_policy ON public.group_post_participants;
CREATE POLICY participants_insert_policy ON public.group_post_participants
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((is_group_post_creator(group_post_id) OR is_group_post_organizer(group_post_id)));
DROP POLICY IF EXISTS participants_select_policy ON public.group_post_participants;
CREATE POLICY participants_select_policy ON public.group_post_participants
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR can_view_group_post(group_post_id)));
DROP POLICY IF EXISTS participants_update_policy ON public.group_post_participants;
CREATE POLICY participants_update_policy ON public.group_post_participants
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR is_group_post_creator(group_post_id) OR is_group_post_organizer(group_post_id)));
DROP POLICY IF EXISTS group_posts_delete_policy ON public.group_posts;
CREATE POLICY group_posts_delete_policy ON public.group_posts
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((( SELECT auth.uid() AS uid) = creator_id));
DROP POLICY IF EXISTS group_posts_insert_policy ON public.group_posts;
CREATE POLICY group_posts_insert_policy ON public.group_posts
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = creator_id));
DROP POLICY IF EXISTS group_posts_select_policy ON public.group_posts;
CREATE POLICY group_posts_select_policy ON public.group_posts
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((creator_id = ( SELECT auth.uid() AS uid)) OR (visibility = 'public'::text) OR is_group_post_participant(id)));
DROP POLICY IF EXISTS group_posts_update_policy ON public.group_posts;
CREATE POLICY group_posts_update_policy ON public.group_posts
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((( SELECT auth.uid() AS uid) = creator_id));
DROP POLICY IF EXISTS "Users can view their own handle history" ON public.handle_history;
CREATE POLICY "Users can view their own handle history" ON public.handle_history
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((( SELECT auth.uid() AS uid) = profile_id));
DROP POLICY IF EXISTS "Participants can add reactions" ON public.message_reactions;
CREATE POLICY "Participants can add reactions" ON public.message_reactions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((profile_id = ( SELECT auth.uid() AS uid)) AND is_conversation_participant(( SELECT messages.conversation_id
   FROM messages
  WHERE (messages.id = message_reactions.message_id)), ( SELECT auth.uid() AS uid))));
DROP POLICY IF EXISTS "Participants can view reactions" ON public.message_reactions;
CREATE POLICY "Participants can view reactions" ON public.message_reactions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (is_conversation_participant(( SELECT messages.conversation_id
   FROM messages
  WHERE (messages.id = message_reactions.message_id)), ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Users can remove own reactions" ON public.message_reactions;
CREATE POLICY "Users can remove own reactions" ON public.message_reactions
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Authed users can file reports" ON public.message_reports;
CREATE POLICY "Authed users can file reports" ON public.message_reports
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((reporter_id = ( SELECT auth.uid() AS uid)) AND ((conversation_id IS NULL) OR is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)))));
DROP POLICY IF EXISTS "Reporters can view own reports" ON public.message_reports;
CREATE POLICY "Reporters can view own reports" ON public.message_reports
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((reporter_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Participants can insert messages" ON public.messages;
CREATE POLICY "Participants can insert messages" ON public.messages
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((sender_id = ( SELECT auth.uid() AS uid)) AND is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))));
DROP POLICY IF EXISTS "Participants can view messages" ON public.messages;
CREATE POLICY "Participants can view messages" ON public.messages
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((deleted_at IS NULL) AND is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))));
DROP POLICY IF EXISTS "Sender can soft-delete own message" ON public.messages;
CREATE POLICY "Sender can soft-delete own message" ON public.messages
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((sender_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS notification_preferences_insert_policy ON public.notification_preferences;
CREATE POLICY notification_preferences_insert_policy ON public.notification_preferences
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS notification_preferences_select_policy ON public.notification_preferences;
CREATE POLICY notification_preferences_select_policy ON public.notification_preferences
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS notification_preferences_update_policy ON public.notification_preferences;
CREATE POLICY notification_preferences_update_policy ON public.notification_preferences
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS notifications_delete_policy ON public.notifications;
CREATE POLICY notifications_delete_policy ON public.notifications
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS notifications_select_policy ON public.notifications;
CREATE POLICY notifications_select_policy ON public.notifications
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS notifications_update_policy ON public.notifications;
CREATE POLICY notifications_update_policy ON public.notifications
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS performances_delete_policy ON public.performances;
CREATE POLICY performances_delete_policy ON public.performances
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS performances_insert_policy ON public.performances;
CREATE POLICY performances_insert_policy ON public.performances
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS performances_profile_access_select ON public.performances;
CREATE POLICY performances_profile_access_select ON public.performances
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS performances_select_policy ON public.performances;
CREATE POLICY performances_select_policy ON public.performances
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = performances.profile_id) AND ((profiles.visibility = 'public'::text) OR (EXISTS ( SELECT 1
           FROM follows
          WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = performances.profile_id) AND (follows.status = 'accepted'::text))))))))));
DROP POLICY IF EXISTS performances_update_policy ON public.performances;
CREATE POLICY performances_update_policy ON public.performances
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Place aliases are viewable by everyone" ON public.place_aliases;
CREATE POLICY "Place aliases are viewable by everyone" ON public.place_aliases
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "Places are viewable by everyone" ON public.places;
CREATE POLICY "Places are viewable by everyone" ON public.places
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS post_comments_delete_policy ON public.post_comments;
CREATE POLICY post_comments_delete_policy ON public.post_comments
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS post_comments_insert_policy ON public.post_comments;
CREATE POLICY post_comments_insert_policy ON public.post_comments
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS post_comments_select_policy ON public.post_comments;
CREATE POLICY post_comments_select_policy ON public.post_comments
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS post_comments_update_policy ON public.post_comments;
CREATE POLICY post_comments_update_policy ON public.post_comments
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS post_likes_delete_policy ON public.post_likes;
CREATE POLICY post_likes_delete_policy ON public.post_likes
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS post_likes_insert_policy ON public.post_likes;
CREATE POLICY post_likes_insert_policy ON public.post_likes
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS post_likes_select_policy ON public.post_likes;
CREATE POLICY post_likes_select_policy ON public.post_likes
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS post_media_delete_policy ON public.post_media;
CREATE POLICY post_media_delete_policy ON public.post_media
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM posts
  WHERE ((posts.id = post_media.post_id) AND (posts.profile_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS post_media_insert_policy ON public.post_media;
CREATE POLICY post_media_insert_policy ON public.post_media
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM posts
  WHERE ((posts.id = post_media.post_id) AND (posts.profile_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS post_media_profile_access_select ON public.post_media;
CREATE POLICY post_media_profile_access_select ON public.post_media
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = post_media.post_id) AND has_profile_access(p.profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])))));
DROP POLICY IF EXISTS post_media_select_policy ON public.post_media;
CREATE POLICY post_media_select_policy ON public.post_media
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM posts
  WHERE ((posts.id = post_media.post_id) AND ((posts.profile_id = ( SELECT auth.uid() AS uid)) OR (posts.visibility = 'public'::text) OR (EXISTS ( SELECT 1
           FROM follows
          WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = posts.profile_id) AND (follows.status = 'accepted'::text)))))))));
DROP POLICY IF EXISTS post_media_update_policy ON public.post_media;
CREATE POLICY post_media_update_policy ON public.post_media
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM posts
  WHERE ((posts.id = post_media.post_id) AND (posts.profile_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS post_tags_delete_policy ON public.post_tags;
CREATE POLICY post_tags_delete_policy ON public.post_tags
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((( SELECT auth.uid() AS uid) = created_by_profile_id));
DROP POLICY IF EXISTS post_tags_insert_policy ON public.post_tags;
CREATE POLICY post_tags_insert_policy ON public.post_tags
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) = created_by_profile_id) AND (EXISTS ( SELECT 1
   FROM posts
  WHERE ((posts.id = post_tags.post_id) AND (posts.profile_id = ( SELECT auth.uid() AS uid)))))));
DROP POLICY IF EXISTS post_tags_select_policy ON public.post_tags;
CREATE POLICY post_tags_select_policy ON public.post_tags
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((((status = 'active'::text) AND (EXISTS ( SELECT 1
   FROM posts
  WHERE ((posts.id = post_tags.post_id) AND (posts.visibility = 'public'::text))))) OR ((( SELECT auth.uid() AS uid) = created_by_profile_id) OR (( SELECT auth.uid() AS uid) = tagged_profile_id))));
DROP POLICY IF EXISTS post_tags_update_policy ON public.post_tags;
CREATE POLICY post_tags_update_policy ON public.post_tags
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((( SELECT auth.uid() AS uid) = created_by_profile_id) OR (( SELECT auth.uid() AS uid) = tagged_profile_id)));
DROP POLICY IF EXISTS posts_delete_policy ON public.posts;
CREATE POLICY posts_delete_policy ON public.posts
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS posts_guardian_write ON public.posts;
CREATE POLICY posts_guardian_write ON public.posts
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
  WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS posts_insert_policy ON public.posts;
CREATE POLICY posts_insert_policy ON public.posts
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS posts_profile_access_select ON public.posts;
CREATE POLICY posts_profile_access_select ON public.posts
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS posts_select_policy ON public.posts;
CREATE POLICY posts_select_policy ON public.posts
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR ((status = 'published'::text) AND ((visibility = 'public'::text) OR (EXISTS ( SELECT 1
   FROM follows
  WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = posts.profile_id) AND (follows.status = 'accepted'::text))))))));
DROP POLICY IF EXISTS posts_update_policy ON public.posts;
CREATE POLICY posts_update_policy ON public.posts
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS privacy_settings_insert_policy ON public.privacy_settings;
CREATE POLICY privacy_settings_insert_policy ON public.privacy_settings
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS privacy_settings_select_policy ON public.privacy_settings;
CREATE POLICY privacy_settings_select_policy ON public.privacy_settings
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS privacy_settings_update_policy ON public.privacy_settings;
CREATE POLICY privacy_settings_update_policy ON public.privacy_settings
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS profile_access_select_policy ON public.profile_access;
CREATE POLICY profile_access_select_policy ON public.profile_access
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (profile_id = ( SELECT auth.uid() AS uid))));
DROP POLICY IF EXISTS profile_access_audit_select_policy ON public.profile_access_audit;
CREATE POLICY profile_access_audit_select_policy ON public.profile_access_audit
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (profile_id = ( SELECT auth.uid() AS uid))));
DROP POLICY IF EXISTS profiles_profile_access_select ON public.profiles;
CREATE POLICY profiles_profile_access_select ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((id = ( SELECT auth.uid() AS uid)) OR (visibility = 'public'::text) OR (EXISTS ( SELECT 1
   FROM follows
  WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = profiles.id) AND (follows.status = 'accepted'::text))))));
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Reserved handles are viewable by everyone" ON public.reserved_handles;
CREATE POLICY "Reserved handles are viewable by everyone" ON public.reserved_handles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS saved_posts_delete_policy ON public.saved_posts;
CREATE POLICY saved_posts_delete_policy ON public.saved_posts
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS saved_posts_insert_policy ON public.saved_posts;
CREATE POLICY saved_posts_insert_policy ON public.saved_posts
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS saved_posts_select_policy ON public.saved_posts;
CREATE POLICY saved_posts_select_policy ON public.saved_posts
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS season_highlights_delete_policy ON public.season_highlights;
CREATE POLICY season_highlights_delete_policy ON public.season_highlights
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS season_highlights_insert_policy ON public.season_highlights;
CREATE POLICY season_highlights_insert_policy ON public.season_highlights
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS season_highlights_profile_access_select ON public.season_highlights;
CREATE POLICY season_highlights_profile_access_select ON public.season_highlights
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS season_highlights_select_policy ON public.season_highlights;
CREATE POLICY season_highlights_select_policy ON public.season_highlights
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = season_highlights.profile_id) AND ((profiles.visibility = 'public'::text) OR (EXISTS ( SELECT 1
           FROM follows
          WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = season_highlights.profile_id) AND (follows.status = 'accepted'::text))))))))));
DROP POLICY IF EXISTS season_highlights_update_policy ON public.season_highlights;
CREATE POLICY season_highlights_update_policy ON public.season_highlights
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Users can delete their own sport settings" ON public.sport_settings;
CREATE POLICY "Users can delete their own sport settings" ON public.sport_settings
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((( SELECT auth.uid() AS uid) = profile_id));
DROP POLICY IF EXISTS "Users can insert their own sport settings" ON public.sport_settings;
CREATE POLICY "Users can insert their own sport settings" ON public.sport_settings
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = profile_id));
DROP POLICY IF EXISTS "Users can update their own sport settings" ON public.sport_settings;
CREATE POLICY "Users can update their own sport settings" ON public.sport_settings
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((( SELECT auth.uid() AS uid) = profile_id));
DROP POLICY IF EXISTS "Users can view their own sport settings" ON public.sport_settings;
CREATE POLICY "Users can view their own sport settings" ON public.sport_settings
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((( SELECT auth.uid() AS uid) = profile_id));
DROP POLICY IF EXISTS sport_settings_delete_policy ON public.sport_settings;
CREATE POLICY sport_settings_delete_policy ON public.sport_settings
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS sport_settings_insert_policy ON public.sport_settings;
CREATE POLICY sport_settings_insert_policy ON public.sport_settings
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS sport_settings_select_policy ON public.sport_settings;
CREATE POLICY sport_settings_select_policy ON public.sport_settings
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS sport_settings_update_policy ON public.sport_settings;
CREATE POLICY sport_settings_update_policy ON public.sport_settings
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS sports_insert_policy ON public.sports;
CREATE POLICY sports_insert_policy ON public.sports
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));
DROP POLICY IF EXISTS sports_select_policy ON public.sports;
CREATE POLICY sports_select_policy ON public.sports
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "Users manage own blocks" ON public.user_blocks;
CREATE POLICY "Users manage own blocks" ON public.user_blocks
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((blocker_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Users see own blocks" ON public.user_blocks;
CREATE POLICY "Users see own blocks" ON public.user_blocks
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((blocker_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "Venues are viewable by everyone" ON public.venues;
CREATE POLICY "Venues are viewable by everyone" ON public.venues
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS workout_exercises_delete_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_delete_policy ON public.workout_exercises
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_exercises_guardian_write ON public.workout_exercises;
CREATE POLICY workout_exercises_guardian_write ON public.workout_exercises
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
  WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_exercises_insert_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_insert_policy ON public.workout_exercises
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_exercises_profile_access_select ON public.workout_exercises;
CREATE POLICY workout_exercises_profile_access_select ON public.workout_exercises
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS workout_exercises_select_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_select_policy ON public.workout_exercises
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = workout_exercises.profile_id) AND (p.visibility = 'public'::text))))));
DROP POLICY IF EXISTS workout_exercises_update_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_update_policy ON public.workout_exercises
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_routine_exercises_delete_policy ON public.workout_routine_exercises;
CREATE POLICY workout_routine_exercises_delete_policy ON public.workout_routine_exercises
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_routine_exercises_insert_policy ON public.workout_routine_exercises;
CREATE POLICY workout_routine_exercises_insert_policy ON public.workout_routine_exercises
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_routine_exercises_select_policy ON public.workout_routine_exercises;
CREATE POLICY workout_routine_exercises_select_policy ON public.workout_routine_exercises
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_routine_exercises_update_policy ON public.workout_routine_exercises;
CREATE POLICY workout_routine_exercises_update_policy ON public.workout_routine_exercises
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_routines_delete_policy ON public.workout_routines;
CREATE POLICY workout_routines_delete_policy ON public.workout_routines
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_routines_insert_policy ON public.workout_routines;
CREATE POLICY workout_routines_insert_policy ON public.workout_routines
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_routines_select_policy ON public.workout_routines;
CREATE POLICY workout_routines_select_policy ON public.workout_routines
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_routines_update_policy ON public.workout_routines;
CREATE POLICY workout_routines_update_policy ON public.workout_routines
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_sessions_delete_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_delete_policy ON public.workout_sessions
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_sessions_guardian_write ON public.workout_sessions;
CREATE POLICY workout_sessions_guardian_write ON public.workout_sessions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
  WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_sessions_insert_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_insert_policy ON public.workout_sessions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_sessions_profile_access_select ON public.workout_sessions;
CREATE POLICY workout_sessions_profile_access_select ON public.workout_sessions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS workout_sessions_select_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_select_policy ON public.workout_sessions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = workout_sessions.profile_id) AND (p.visibility = 'public'::text))))));
DROP POLICY IF EXISTS workout_sessions_update_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_update_policy ON public.workout_sessions
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_sets_delete_policy ON public.workout_sets;
CREATE POLICY workout_sets_delete_policy ON public.workout_sets
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_sets_guardian_write ON public.workout_sets;
CREATE POLICY workout_sets_guardian_write ON public.workout_sets
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
  WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_sets_insert_policy ON public.workout_sets;
CREATE POLICY workout_sets_insert_policy ON public.workout_sets
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS workout_sets_profile_access_select ON public.workout_sets;
CREATE POLICY workout_sets_profile_access_select ON public.workout_sets
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
DROP POLICY IF EXISTS workout_sets_select_policy ON public.workout_sets;
CREATE POLICY workout_sets_select_policy ON public.workout_sets
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = workout_sets.profile_id) AND (p.visibility = 'public'::text))))));
DROP POLICY IF EXISTS workout_sets_update_policy ON public.workout_sets;
CREATE POLICY workout_sets_update_policy ON public.workout_sets
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((profile_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS "User Delete" ON storage.objects;
CREATE POLICY "User Delete" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((bucket_id = 'avatars'::text));
DROP POLICY IF EXISTS "User Update" ON storage.objects;
CREATE POLICY "User Update" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((bucket_id = 'avatars'::text));
DROP POLICY IF EXISTS "User Upload" ON storage.objects;
CREATE POLICY "User Upload" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((bucket_id = 'avatars'::text));
DROP POLICY IF EXISTS "User Upload to Uploads" ON storage.objects;
CREATE POLICY "User Upload to Uploads" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((bucket_id = 'uploads'::text));
DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;
CREATE POLICY "Users can delete their own files" ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((bucket_id = 'uploads'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));
DROP POLICY IF EXISTS "Users can update their own files" ON storage.objects;
CREATE POLICY "Users can update their own files" ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((bucket_id = 'uploads'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));
DROP POLICY IF EXISTS "Users can upload their own files" ON storage.objects;
CREATE POLICY "Users can upload their own files" ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((bucket_id = 'uploads'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));

-- ── Table and view grants ─────────────────────────────────────────────────────
REVOKE ALL ON TABLE public.affiliations FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.affiliations TO service_role;
REVOKE ALL ON TABLE public.approved_contacts FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.approved_contacts TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.approved_contacts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.approved_contacts TO service_role;
REVOKE ALL ON TABLE public.athlete_achievements FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_achievements TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_achievements TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_achievements TO service_role;
REVOKE ALL ON TABLE public.athlete_claim_invites FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_claim_invites TO service_role;
REVOKE ALL ON TABLE public.athlete_equipment FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_equipment TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_equipment TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_equipment TO service_role;
REVOKE ALL ON TABLE public.athlete_performances FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_performances TO service_role;
REVOKE ALL ON TABLE public.athlete_vitals FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_vitals TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_vitals TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.athlete_vitals TO service_role;
REVOKE ALL ON TABLE public.calendar_feed_tokens FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.calendar_feed_tokens TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.calendar_feed_tokens TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.calendar_feed_tokens TO service_role;
REVOKE ALL ON TABLE public.comment_likes FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.comment_likes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.comment_likes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.comment_likes TO service_role;
REVOKE ALL ON TABLE public.competition_entries FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competition_entries TO service_role;
REVOKE ALL ON TABLE public.competition_entry_members FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competition_entry_members TO service_role;
REVOKE ALL ON TABLE public.competition_standings FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competition_standings TO service_role;
REVOKE ALL ON TABLE public.competitions FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitions TO service_role;
REVOKE ALL ON TABLE public.connection_suggestions FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.connection_suggestions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.connection_suggestions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.connection_suggestions TO service_role;
REVOKE ALL ON TABLE public.consent_records FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.consent_records TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.consent_records TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.consent_records TO service_role;
REVOKE ALL ON TABLE public.contact_messages FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contact_messages TO service_role;
REVOKE ALL ON TABLE public.contest_media FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contest_media TO service_role;
REVOKE ALL ON TABLE public.contest_media_tags FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contest_media_tags TO service_role;
REVOKE ALL ON TABLE public.contest_participants FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contest_participants TO service_role;
REVOKE ALL ON TABLE public.contest_results FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contest_results TO service_role;
REVOKE ALL ON TABLE public.contest_stat_lines FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contest_stat_lines TO service_role;
REVOKE ALL ON TABLE public.contests FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contests TO service_role;
REVOKE ALL ON TABLE public.conversation_participants FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conversation_participants TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conversation_participants TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conversation_participants TO service_role;
REVOKE ALL ON TABLE public.conversations FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conversations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conversations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conversations TO service_role;
REVOKE ALL ON TABLE public.divisions FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.divisions TO service_role;
REVOKE ALL ON TABLE public.event_carpool_claims FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_carpool_claims TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_carpool_claims TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_carpool_claims TO service_role;
REVOKE ALL ON TABLE public.event_carpool_offers FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_carpool_offers TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_carpool_offers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_carpool_offers TO service_role;
REVOKE ALL ON TABLE public.event_guests FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_guests TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_guests TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_guests TO service_role;
REVOKE ALL ON TABLE public.event_series FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_series TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_series TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.event_series TO service_role;
REVOKE ALL ON TABLE public.events FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.events TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.events TO service_role;
REVOKE ALL ON TABLE public.facilities FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.facilities TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.facilities TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.facilities TO service_role;
REVOKE ALL ON TABLE public.follows FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.follows TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.follows TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.follows TO service_role;
REVOKE ALL ON TABLE public.golf_clubs FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_clubs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_clubs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_clubs TO service_role;
REVOKE ALL ON TABLE public.golf_courses FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_courses TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_courses TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_courses TO service_role;
REVOKE ALL ON TABLE public.golf_hole_scores FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_hole_scores TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_hole_scores TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_hole_scores TO service_role;
REVOKE ALL ON TABLE public.golf_holes FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_holes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_holes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_holes TO service_role;
REVOKE ALL ON TABLE public.golf_participant_scores FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_participant_scores TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_participant_scores TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_participant_scores TO service_role;
REVOKE ALL ON TABLE public.golf_rounds FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_rounds TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_rounds TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_rounds TO service_role;
REVOKE ALL ON TABLE public.golf_scorecard_data FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_scorecard_data TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_scorecard_data TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.golf_scorecard_data TO service_role;
REVOKE ALL ON TABLE public.group_post_media FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.group_post_media TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.group_post_media TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.group_post_media TO service_role;
REVOKE ALL ON TABLE public.group_post_participants FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.group_post_participants TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.group_post_participants TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.group_post_participants TO service_role;
REVOKE ALL ON TABLE public.group_posts FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.group_posts TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.group_posts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.group_posts TO service_role;
REVOKE ALL ON TABLE public.guardian_invites FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.guardian_invites TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.guardian_invites TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.guardian_invites TO service_role;
REVOKE ALL ON TABLE public.handle_history FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.handle_history TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.handle_history TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.handle_history TO service_role;
REVOKE ALL ON TABLE public.help_articles FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.help_articles TO service_role;
REVOKE ALL ON TABLE public.memberships FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.memberships TO service_role;
REVOKE ALL ON TABLE public.message_reactions FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.message_reactions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.message_reactions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.message_reactions TO service_role;
REVOKE ALL ON TABLE public.message_reports FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.message_reports TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.message_reports TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.message_reports TO service_role;
REVOKE ALL ON TABLE public.messages FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.messages TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.messages TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.messages TO service_role;
REVOKE ALL ON TABLE public.notification_preferences FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notification_preferences TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notification_preferences TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notification_preferences TO service_role;
REVOKE ALL ON TABLE public.notifications FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO service_role;
REVOKE ALL ON TABLE public.org_claim_invites FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_claim_invites TO service_role;
REVOKE ALL ON TABLE public.org_join_requests FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_join_requests TO service_role;
REVOKE ALL ON TABLE public.org_requests FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_requests TO service_role;
REVOKE ALL ON TABLE public.org_site_form_submissions FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_site_form_submissions TO service_role;
REVOKE ALL ON TABLE public.org_site_hit_marks FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_site_hit_marks TO service_role;
REVOKE ALL ON TABLE public.org_site_modules FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_site_modules TO service_role;
REVOKE ALL ON TABLE public.org_site_news FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_site_news TO service_role;
REVOKE ALL ON TABLE public.org_site_pages FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_site_pages TO service_role;
REVOKE ALL ON TABLE public.org_site_revisions FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_site_revisions TO service_role;
REVOKE ALL ON TABLE public.org_site_stats_daily FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_site_stats_daily TO service_role;
REVOKE ALL ON TABLE public.org_sites FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_sites TO service_role;
REVOKE ALL ON TABLE public.org_staff_audit FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_staff_audit TO service_role;
REVOKE ALL ON TABLE public.org_staff_invites FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.org_staff_invites TO service_role;
REVOKE ALL ON TABLE public.organizations FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.organizations TO service_role;
REVOKE ALL ON TABLE public.pending_profiles FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pending_profiles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pending_profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pending_profiles TO service_role;
REVOKE ALL ON TABLE public.performances FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.performances TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.performances TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.performances TO service_role;
REVOKE ALL ON TABLE public.place_aliases FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.place_aliases TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.place_aliases TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.place_aliases TO service_role;
REVOKE ALL ON TABLE public.places FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.places TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.places TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.places TO service_role;
REVOKE ALL ON TABLE public.platform_admins FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.platform_admins TO service_role;
REVOKE ALL ON TABLE public.post_comments FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_comments TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_comments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_comments TO service_role;
REVOKE ALL ON TABLE public.post_likes FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_likes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_likes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_likes TO service_role;
REVOKE ALL ON TABLE public.post_media FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_media TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_media TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_media TO service_role;
REVOKE ALL ON TABLE public.post_tags FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_tags TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_tags TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_tags TO service_role;
REVOKE ALL ON TABLE public.posts FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.posts TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.posts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.posts TO service_role;
REVOKE ALL ON TABLE public.privacy_settings FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.privacy_settings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.privacy_settings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.privacy_settings TO service_role;
REVOKE ALL ON TABLE public.profile_access FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profile_access TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profile_access TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profile_access TO service_role;
REVOKE ALL ON TABLE public.profile_access_audit FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profile_access_audit TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profile_access_audit TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profile_access_audit TO service_role;
REVOKE ALL ON TABLE public.profile_transfers FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profile_transfers TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profile_transfers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profile_transfers TO service_role;
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profiles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profiles TO service_role;
REVOKE ALL ON TABLE public.programs FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.programs TO service_role;
REVOKE ALL ON TABLE public.rate_limits FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rate_limits TO service_role;
REVOKE ALL ON TABLE public.registration_windows FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.registration_windows TO service_role;
REVOKE ALL ON TABLE public.registrations FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.registrations TO service_role;
REVOKE ALL ON TABLE public.reserved_handles FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.reserved_handles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.reserved_handles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.reserved_handles TO service_role;
REVOKE ALL ON TABLE public.risk_signals FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.risk_signals TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.risk_signals TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.risk_signals TO service_role;
REVOKE ALL ON TABLE public.safety_settings_audit FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.safety_settings_audit TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.safety_settings_audit TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.safety_settings_audit TO service_role;
REVOKE ALL ON TABLE public.sanction_grants FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sanction_grants TO service_role;
REVOKE ALL ON TABLE public.saved_posts FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.saved_posts TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.saved_posts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.saved_posts TO service_role;
REVOKE ALL ON TABLE public.schema_migrations FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.schema_migrations TO service_role;
REVOKE ALL ON TABLE public.scout_shortlists FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.scout_shortlists TO service_role;
REVOKE ALL ON TABLE public.search_documents FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.search_documents TO service_role;
REVOKE ALL ON TABLE public.season_highlights FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.season_highlights TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.season_highlights TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.season_highlights TO service_role;
REVOKE ALL ON TABLE public.seasons FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.seasons TO service_role;
REVOKE ALL ON TABLE public.sport_event_group_members FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_event_group_members TO service_role;
REVOKE ALL ON TABLE public.sport_event_groups FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_event_groups TO service_role;
REVOKE ALL ON TABLE public.sport_event_matches FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_event_matches TO service_role;
REVOKE ALL ON TABLE public.sport_event_media FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_event_media TO service_role;
REVOKE ALL ON TABLE public.sport_event_participants FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_event_participants TO service_role;
REVOKE ALL ON TABLE public.sport_event_rounds FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_event_rounds TO service_role;
REVOKE ALL ON TABLE public.sport_event_stat_lines FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_event_stat_lines TO service_role;
REVOKE ALL ON TABLE public.sport_events FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_events TO service_role;
REVOKE ALL ON TABLE public.sport_settings FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_settings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_settings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sport_settings TO service_role;
REVOKE ALL ON TABLE public.sports FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sports TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sports TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sports TO service_role;
REVOKE ALL ON TABLE public.team_entries FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.team_entries TO service_role;
REVOKE ALL ON TABLE public.teams FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.teams TO service_role;
REVOKE ALL ON TABLE public.ticket_events FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ticket_events TO service_role;
REVOKE ALL ON TABLE public.tickets FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.tickets TO service_role;
REVOKE ALL ON TABLE public.user_blocks FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_blocks TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_blocks TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_blocks TO service_role;
REVOKE ALL ON TABLE public.user_media_presets FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_media_presets TO service_role;
REVOKE ALL ON TABLE public.user_mutes FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_mutes TO service_role;
REVOKE ALL ON TABLE public.venues FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.venues TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.venues TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.venues TO service_role;
REVOKE ALL ON TABLE public.waitlist FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.waitlist TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.waitlist TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.waitlist TO service_role;
REVOKE ALL ON TABLE public.workout_exercises FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_exercises TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_exercises TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_exercises TO service_role;
REVOKE ALL ON TABLE public.workout_routine_exercises FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_routine_exercises TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_routine_exercises TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_routine_exercises TO service_role;
REVOKE ALL ON TABLE public.workout_routines FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_routines TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_routines TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_routines TO service_role;
REVOKE ALL ON TABLE public.workout_sessions FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_sessions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_sessions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_sessions TO service_role;
REVOKE ALL ON TABLE public.workout_sets FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_sets TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_sets TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workout_sets TO service_role;
REVOKE ALL ON TABLE public.clubs FROM anon, authenticated, service_role;
GRANT DELETE, SELECT, UPDATE ON TABLE public.clubs TO service_role;
REVOKE ALL ON TABLE public.leagues FROM anon, authenticated, service_role;
GRANT DELETE, SELECT, UPDATE ON TABLE public.leagues TO service_role;

-- ── Sequence grants ───────────────────────────────────────────────────────────
REVOKE ALL ON SEQUENCE public.tickets_number_seq FROM anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.tickets_number_seq TO anon, authenticated, service_role;

-- ── Function grants ───────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.auto_update_display_name() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_update_display_name() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.backfill_places_from_text(p_table regclass) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_places_from_text(p_table regclass) TO service_role;
REVOKE EXECUTE ON FUNCTION public.bump_hole_score_version() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bump_hole_score_version() TO service_role;
REVOKE EXECUTE ON FUNCTION public.bump_site_hit(p_site uuid, p_day date, p_path text, p_hash text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bump_site_hit(p_site uuid, p_day date, p_path text, p_hash text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.calculate_golf_participant_totals() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_golf_participant_totals() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.calculate_round_stats(round_uuid uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_round_stats(round_uuid uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.can_view_group_post(gp_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_group_post(gp_id uuid) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_view_profile(target_profile_id uuid, viewer_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_profile(target_profile_id uuid, viewer_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.check_handle_availability(input_handle text, current_profile_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_handle_availability(input_handle text, current_profile_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_notifications() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications() TO service_role;
REVOKE EXECUTE ON FUNCTION public.consent_records_forbid_mutation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consent_records_forbid_mutation() TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_managed_profile(p_profile jsonb, p_guardian uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_managed_profile(p_profile jsonb, p_guardian uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_notification(p_user_id uuid, p_type text, p_actor_id uuid, p_title text, p_message text, p_action_url text, p_post_id uuid, p_comment_id uuid, p_follow_id uuid, p_metadata jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(p_user_id uuid, p_type text, p_actor_id uuid, p_title text, p_message text, p_action_url text, p_post_id uuid, p_comment_id uuid, p_follow_id uuid, p_metadata jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_profile_with_owner(p_profile jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_profile_with_owner(p_profile jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_stub_profile(p_id uuid, p_email text, p_first_name text, p_last_name text, p_created_by uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_stub_profile(p_id uuid, p_email text, p_first_name text, p_last_name text, p_created_by uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.decrement_comment_likes_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_comment_likes_count() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.decrement_post_save_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_post_save_count() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.enforce_guardian_cap() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_guardian_cap() TO service_role;
REVOKE EXECUTE ON FUNCTION public.enforce_last_guardian() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_last_guardian() TO service_role;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_has_access() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_profile_has_access() TO service_role;
REVOKE EXECUTE ON FUNCTION public.feed_following(p_viewer uuid, p_limit integer, p_cursor_ts timestamp with time zone, p_cursor_id uuid, p_offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.feed_following(p_viewer uuid, p_limit integer, p_cursor_ts timestamp with time zone, p_cursor_id uuid, p_offset integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.follows_counts_sync() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.follows_counts_sync() TO service_role;
REVOKE EXECUTE ON FUNCTION public.forbid_mutation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.forbid_mutation() TO service_role;
REVOKE EXECUTE ON FUNCTION public.generate_connection_suggestions(p_user_profile_id uuid, p_suggestion_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_connection_suggestions(p_user_profile_id uuid, p_suggestion_limit integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_actor_display_name(p_profile_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_actor_display_name(p_profile_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_conversation_list(p_user_id uuid, p_limit integer, p_before timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conversation_list(p_user_id uuid, p_limit integer, p_before timestamp with time zone) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_golf_round_years(p_profile_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_golf_round_years(p_profile_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_golf_scorecard(p_group_post_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_golf_scorecard(p_group_post_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_group_post_details(p_group_post_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_group_post_details(p_group_post_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_pending_requests_count(target_profile_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_requests_count(target_profile_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_profile_all_media(target_profile_id uuid, viewer_id uuid, media_limit integer, media_offset integer, filter_sport_keys text[], filter_years integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_all_media(target_profile_id uuid, viewer_id uuid, media_limit integer, media_offset integer, filter_sport_keys text[], filter_years integer[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_profile_media_counts(target_profile_id uuid, viewer_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_media_counts(target_profile_id uuid, viewer_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_profile_post_sport_keys(p_profile_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_post_sport_keys(p_profile_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_profile_statements_media(target_profile_id uuid, viewer_id uuid, media_limit integer, media_offset integer, filter_sport_keys text[], filter_years integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_statements_media(target_profile_id uuid, viewer_id uuid, media_limit integer, media_offset integer, filter_sport_keys text[], filter_years integer[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_profile_stats_media(target_profile_id uuid, viewer_id uuid, media_limit integer, media_offset integer, filter_sport_keys text[], filter_years integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_stats_media(target_profile_id uuid, viewer_id uuid, media_limit integer, media_offset integer, filter_sport_keys text[], filter_years integer[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_profile_tagged_media(target_profile_id uuid, viewer_id uuid, media_limit integer, media_offset integer, filter_sport_keys text[], filter_years integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_tagged_media(target_profile_id uuid, viewer_id uuid, media_limit integer, media_offset integer, filter_sport_keys text[], filter_years integer[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_profile_tagged_summary(target_profile_id uuid, viewer_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_tagged_summary(target_profile_id uuid, viewer_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_tagged_posts(target_profile_id uuid, current_user_id uuid, page_limit integer, page_offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tagged_posts(target_profile_id uuid, current_user_id uuid, page_limit integer, page_offset integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_unread_message_count(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unread_message_count(p_user_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_unread_notification_count(user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(user_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.golf_course_location_facets(p_country_code text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.golf_course_location_facets(p_country_code text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.golf_courses_search_vector_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.golf_courses_search_vector_update() TO service_role;
REVOKE EXECUTE ON FUNCTION public.grant_guardian_access(p_profile uuid, p_new_guardian uuid, p_actor uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_guardian_access(p_profile uuid, p_new_guardian uuid, p_actor uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_updated_at() TO service_role;
REVOKE EXECUTE ON FUNCTION public.has_profile_access(p_profile_id uuid, p_roles text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_profile_access(p_profile_id uuid, p_roles text[]) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.hole_score_group_post(gps_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hole_score_group_post(gps_id uuid) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.increment_comment_likes_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_comment_likes_count() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.increment_post_save_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_post_save_count() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(conv_id uuid, user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(conv_id uuid, user_id uuid) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_group_post_creator(gp_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_group_post_creator(gp_id uuid) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_group_post_organizer(gp_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_group_post_organizer(gp_id uuid) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_group_post_participant(gp_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_group_post_participant(gp_id uuid) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_valid_handle(input_handle text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_handle(input_handle text) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.notify_comment_like() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_comment_like() TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify_follow_accepted() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_follow_accepted() TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify_follow_declined() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_follow_declined() TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify_follow_request() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_follow_request() TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify_new_follower() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_new_follower() TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify_post_comment() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_post_comment() TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify_post_like() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_post_like() TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify_profile_tagged() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_profile_tagged() TO service_role;
REVOKE EXECUTE ON FUNCTION public.organizations_kind_immutable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organizations_kind_immutable() TO service_role;
REVOKE EXECUTE ON FUNCTION public.organizations_search_vector_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organizations_search_vector_update() TO service_role;
REVOKE EXECUTE ON FUNCTION public.participant_group_post(p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.participant_group_post(p_id uuid) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.place_context(p_place_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_context(p_place_id uuid) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.place_fields(p_place_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_fields(p_place_id uuid) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.places_search_vector_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.places_search_vector_update() TO service_role;
REVOKE EXECUTE ON FUNCTION public.posts_search_vector_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.posts_search_vector_update() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.profiles_search_vector_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profiles_search_vector_update() TO service_role;
REVOKE EXECUTE ON FUNCTION public.provenance_inventory() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provenance_inventory() TO service_role;
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_org_site_domain(p_slug text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_org_site_domain(p_slug text) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_org_site_host(p_host text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_org_site_host(p_host text) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.schema_dump() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schema_dump() TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_all(q text, p_types text[], max_per_type integer, visible_ids uuid[], include_public boolean, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_all(q text, p_types text[], max_per_type integer, visible_ids uuid[], include_public boolean, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_all_facets(q text, p_types text[], visible_ids uuid[], include_public boolean, p_country_code text, p_region_code text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_all_facets(q text, p_types text[], visible_ids uuid[], include_public boolean, p_country_code text, p_region_code text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_by_handle(search_term text, max_results integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_by_handle(search_term text, max_results integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_clubs(q text, max_results integer, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_clubs(q text, max_results integer, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_doc_delete_org() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_doc_delete_org() TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_athlete() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_doc_sync_athlete() TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_course() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_doc_sync_course() TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_org() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_doc_sync_org() TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_post() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_doc_sync_post() TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_document_delete() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_document_delete() TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_golf_courses(q text, max_results integer, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_golf_courses(q text, max_results integer, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_normalize(t text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_normalize(t text) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.search_people(search_term text, visible_ids uuid[], include_public boolean, max_results integer, require_handle boolean, exclude_id uuid, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_people(search_term text, visible_ids uuid[], include_public boolean, max_results integer, require_handle boolean, exclude_id uuid, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_places(q text, max_results integer, p_country_code text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_places(q text, max_results integer, p_country_code text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_posts(search_query text, max_results integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_posts(search_query text, max_results integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_prefix_tsquery(q text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_prefix_tsquery(q text) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.search_profiles(search_query text, max_results integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_profiles(search_query text, max_results integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.search_query_tokens(q text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_query_tokens(q text) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.search_token_hits(vec tsvector, q text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_token_hits(vec tsvector, q text) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.search_token_rank(vec tsvector, q text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_token_rank(vec tsvector, q text) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.split_full_name() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.split_full_name() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sync_privacy_settings() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_privacy_settings() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_connection_suggestions_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_connection_suggestions_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_conversation_on_message() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_conversation_on_message() TO service_role;
REVOKE EXECUTE ON FUNCTION public.update_equipment_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_equipment_updated_at() TO service_role;
REVOKE EXECUTE ON FUNCTION public.update_follows_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_follows_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_group_post_timestamp() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_group_post_timestamp() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_post_comments_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_post_comments_count() TO service_role;
REVOKE EXECUTE ON FUNCTION public.update_post_likes_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_post_likes_count() TO service_role;
REVOKE EXECUTE ON FUNCTION public.update_post_reposts_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_post_reposts_count() TO service_role;
REVOKE EXECUTE ON FUNCTION public.update_post_tags_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_post_tags_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_user_handle(p_profile_id uuid, p_new_handle text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_user_handle(p_profile_id uuid, p_new_handle text) TO service_role;

-- ── Comments ──────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.affiliations IS 'One edge per (child org, parent org) — Round 5 D-ii (236). A club in a league: org_id = the club, parent_org_id = the league. A league under a parent league: org_id = the child league. initiated_by is which END asked (child | parent). Replaces league_clubs + league_affiliations (dropped in 237).';
COMMENT ON COLUMN public.athlete_equipment.acquired_on IS 'User-editable "in bag since" date; added_at remains the server audit timestamp.';
COMMENT ON COLUMN public.athlete_equipment.retired_on IS 'User-editable retirement date; NULL while status = active.';
COMMENT ON COLUMN public.athlete_equipment.group_label IS 'Optional custom set name ("Tournament bag"). NULL = automatic category grouping only. App-capped at 60 chars.';
COMMENT ON COLUMN public.competition_entries.name IS 'An AD-HOC entry''s label (219): neither a team nor an athlete — a named side with members. Promoting it to a club''s team later = SET team_id; the name stays the snapshot label.';
COMMENT ON COLUMN public.competition_entries.source_ref IS 'The bridge''s idempotency key (219): sport_event_side:<id> — an event''s side minted once as an entry.';
COMMENT ON COLUMN public.competition_entries.affiliation_team_id IS 'A meet athlete''s team for the roll-up (219): snapshotted at entry, organizer-editable; NULL = unattached. Never a second entrant kind.';
COMMENT ON TABLE public.competition_entry_members IS 'Who plays on an entry (219): an ad-hoc side''s members; a team entry may carry members too. Posture A.';
COMMENT ON COLUMN public.contest_media.uploaded_by IS 'Who uploaded it (225: nullable, SET NULL on their deletion).';
COMMENT ON COLUMN public.contest_media_tags.tagged_by IS 'Who tagged (225: nullable, SET NULL on their deletion).';
COMMENT ON COLUMN public.contest_stat_lines.entered_by IS 'Who entered the line (225: nullable, SET NULL on their deletion — the record survives the person).';
COMMENT ON COLUMN public.contests.sport_event_round_id IS 'The event round this contest mirrors (211): one contest per round, minted when the organizer picks the competition; results come from the event''s leaderboard on completion, never from the golf-sync engine.';
COMMENT ON COLUMN public.contests.stage IS 'A bracket round (1 = the first) or a meet session (218); null on a fixture / leaderboard contest. Slot k of stage n+1 is fed by slots 2k−1 and 2k of stage n — by slot, never by id.';
COMMENT ON COLUMN public.contests.slot IS 'The contest''s place within its stage (218): the match number of a bracket round, the order within a meet session. UNIQUE per competition × stage.';
COMMENT ON COLUMN public.contests.sport_event_match_id IS 'The event match this bracket contest is played as (220): stage n ↔ round n, slot k ↔ match k; one contest per match. The outcome is written by closeMatchesOnCompletion, never by hand while linked.';
COMMENT ON COLUMN public.conversation_participants.held_at IS 'First-contact hold (131). Non-null on a supervised child''s row = the conversation is invisible to them until a guardian approves; cleared on approve, row severed (left_at) on deny.';
COMMENT ON COLUMN public.conversations.frozen_at IS 'Frozen by a Critical report (223): no one sends while set; everyone still reads. Distinct from the first-contact hold (131).';
COMMENT ON COLUMN public.conversations.frozen_ticket_id IS 'The ticket that froze it (223).';
COMMENT ON TABLE public.golf_hole_scores IS 'Per-hole detailed scores for golf participants';
COMMENT ON COLUMN public.golf_hole_scores.strokes IS 'Total strokes taken on this hole (1-15)';
COMMENT ON COLUMN public.golf_hole_scores.putts IS 'Number of putts (must be <= strokes)';
COMMENT ON COLUMN public.golf_hole_scores.penalties IS 'Per-hole penalty occurrences for live shared scoring — same model and vocabulary as golf_holes.penalties (078).';
COMMENT ON COLUMN public.golf_hole_scores.version IS 'Per-hole compare-and-set (209): starts at 1, +1 by trigger_bump_hole_score_version only when a scored field changes. A client sends expected_version; the server updates WHERE version = expected — 0 rows is a conflict (409). Never set by a client.';
COMMENT ON COLUMN public.golf_holes.penalties IS 'Per-hole penalty occurrences, one array element each (e.g. {out_of_bounds,drop,drop} = OB x1 + Drop x2). Vocabulary app-validated in src/lib/golf/penalties.ts; no CHECK by design (078 header).';
COMMENT ON TABLE public.golf_participant_scores IS 'Aggregated golf scores for each participant in a golf_round group post';
COMMENT ON COLUMN public.golf_participant_scores.entered_by IS 'Who entered the scores: creator (pre-fill) or participant (self-entry)';
COMMENT ON COLUMN public.golf_participant_scores.scores_confirmed IS 'True when participant has reviewed/confirmed their scores';
COMMENT ON COLUMN public.golf_participant_scores.status IS 'in_progress | submitted (the owner, submitted_at) | final (an organizer, finalized_by). Event rounds only; every other card stays in_progress. Written by src/app/api/sport-events routes on the service client.';
COMMENT ON COLUMN public.golf_rounds.holes IS 'Number of holes played - can be any positive integer (commonly 9 or 18, but supports partial rounds like 5, 12, 15, etc.)';
COMMENT ON COLUMN public.golf_rounds.weather IS 'Weather conditions during the round (e.g., Sunny, Cloudy, Rainy)';
COMMENT ON COLUMN public.golf_rounds.temperature IS 'Temperature in Fahrenheit during the round';
COMMENT ON COLUMN public.golf_rounds.wind IS 'Wind conditions during the round (e.g., Calm, Light Breeze, Windy)';
COMMENT ON COLUMN public.golf_rounds.course_rating IS 'USGA Course Rating (difficulty for scratch golfer)';
COMMENT ON COLUMN public.golf_rounds.slope_rating IS 'USGA Slope Rating (relative difficulty, 55-155)';
COMMENT ON COLUMN public.golf_rounds.round_type IS 'Type of round: outdoor (default) or indoor (simulator/range)';
COMMENT ON COLUMN public.golf_rounds.group_post_id IS 'Set on rounds mirrored from a completed group round (one per participant). NULL for batch-entered solo rounds.';
COMMENT ON TABLE public.golf_scorecard_data IS 'Golf-specific data for group posts of type golf_round';
COMMENT ON COLUMN public.golf_scorecard_data.round_type IS 'outdoor (on course) or indoor (simulator/range)';
COMMENT ON COLUMN public.golf_scorecard_data.holes_played IS 'Number of holes played (supports any count 1-18)';
COMMENT ON COLUMN public.golf_scorecard_data.game_format IS 'Scoring format: stroke (default), stableford (points), match (head-to-head)';
COMMENT ON COLUMN public.golf_scorecard_data.hole_data IS 'Per-hole course data: [{"hole":1,"par":4,"yardage":390}, …]. Source of real pars for group rounds.';
COMMENT ON TABLE public.group_post_media IS 'Shared media gallery for group posts, contributed by multiple participants';
COMMENT ON COLUMN public.group_post_media.thumbnail_url IS 'Poster frame for videos (captured client-side at export). NULL for images.';
COMMENT ON COLUMN public.group_post_media.segment_number IS 'Which slice of the event this media belongs to (hole/inning/quarter/set/lap). NULL = event-level media. Bounds enforced per-sport in segment-schemas.ts, not here.';
COMMENT ON COLUMN public.group_post_media.segment_kind IS 'What that slice is called: hole | inning | quarter | set | lap. Stored rather than derived because this table carries no sport key, so deriving would mean a join on every read.';
COMMENT ON COLUMN public.group_post_media.duration_seconds IS 'Video length in seconds, captured client-side at upload. NULL for images and for rows predating this column.';
COMMENT ON COLUMN public.group_post_media.is_highlight IS 'Athlete-chosen lead item for the round. Multiple rows may be flagged; the picker in src/lib/media/hero.ts resolves deterministically (see the note on the unique index below).';
COMMENT ON TABLE public.group_post_participants IS 'Participants in any group activity (sport-agnostic)';
COMMENT ON COLUMN public.group_post_participants.status IS 'Attestation status: pending (invited), confirmed (participating), declined, maybe';
COMMENT ON COLUMN public.group_post_participants.role IS 'Role in activity: creator, participant, organizer, spectator';
COMMENT ON COLUMN public.group_post_participants.data_contributed IS 'True when participant has added their sport-specific data (scores, stats, etc.)';
COMMENT ON COLUMN public.group_post_participants.position IS 'Creation input order (0-based). NULL for rounds created before migration 071 — readers fall back to created_at, id.';
COMMENT ON TABLE public.group_posts IS 'Generic multi-participant posts for any sport or activity type';
COMMENT ON COLUMN public.group_posts.creator_id IS 'Profile ID of the person who created/organized the activity';
COMMENT ON COLUMN public.group_posts.type IS 'Type of activity: golf_round, hockey_game, volleyball_match, etc.';
COMMENT ON COLUMN public.group_posts.visibility IS 'Who can view this group post: public, private, or participants_only';
COMMENT ON COLUMN public.group_posts.status IS 'pending (draft), active (live), completed (finished), cancelled';
COMMENT ON COLUMN public.group_posts.post_id IS 'Associated social post in feed (auto-created on publish)';
COMMENT ON COLUMN public.group_posts.contest_id IS 'The contest this live round was counted into (181). Written by the golf sync only; SET NULL on contest deletion.';
COMMENT ON COLUMN public.group_posts.sport_event_round_id IS 'The sport event round this live round IS (203). ONE writer: src/lib/sport-events/rounds-server.ts at go-live. SET NULL when the round is deleted — the players keep their round.';
COMMENT ON COLUMN public.guardian_invites.grant_role IS 'Role the claim grants (migration 138): guardian (default, pre-138 invites) or viewer (view-only co-guardian).';
COMMENT ON TABLE public.help_articles IS 'Help Center (224): short articles by topic; a video is an article with a video_url (YouTube, validated by the app). Posture A: the public read is a cached route on the service role filtering published; the owner writes from the console.';
COMMENT ON COLUMN public.help_articles.body IS 'Plain text (224): blank-line paragraphs, "- " bullets; the renderer never trusts HTML.';
COMMENT ON COLUMN public.help_articles.video_url IS 'A YouTube link (224), validated through the site builder''s embed parser — never an arbitrary iframe source.';
COMMENT ON COLUMN public.notification_preferences.urgent_email_enabled IS 'Urgent safety emails (safety_alert/consent_result within ~10 min). ON by default; the settings toggle is the opt-out (135).';
COMMENT ON TABLE public.notifications IS 'Central notifications table for all user notifications';
COMMENT ON COLUMN public.notifications.comment_id IS 'References post_comments.id - no FK for flexibility';
COMMENT ON COLUMN public.notifications.emailed_at IS 'When the urgent-email sweep mailed this row — stamped BEFORE the send (double-send beats never-send; the daily digest ignores this column) (135).';
COMMENT ON TABLE public.org_join_requests IS 'A member''s request to join an org whose join_policy is approval — Round 5 D-ii (236); one per (org, profile). Replaces league_join_requests + club_join_requests (dropped in 237).';
COMMENT ON TABLE public.org_requests IS 'A request to create an org — Round 5 D-ii (236): kind (league | club; a league needs sport_key), the wizard drafts, the decision, the org it created. One pending request per profile across BOTH kinds. Replaces league_requests + club_requests (dropped in 237).';
COMMENT ON COLUMN public.org_site_news.audience IS 'public | members — a private club''s site lists public posts only (phase 9)';
COMMENT ON COLUMN public.org_site_news.pinned_at IS 'Program 3 D3: NULL = not pinned; set = pinned (newest pin first). Read by the public news page and the home section''s pinned-first sort.';
COMMENT ON COLUMN public.org_site_pages.layout IS 'Published SiteLayout of the page (mirrored from the revision snapshot on publish); NULL = legacy body blocks are the truth.';
COMMENT ON COLUMN public.org_site_pages.in_nav IS 'Whether the page is listed in the site header; a hidden page stays reachable at its address.';
COMMENT ON COLUMN public.org_sites.seo_config IS 'Published SEO config (title, description, imagePath) mirrored from the revision snapshot on publish.';
COMMENT ON COLUMN public.org_sites.footer_config IS 'Published footer config (text, links, showSocials) mirrored from the revision snapshot on publish.';
COMMENT ON TABLE public.organizations IS 'One row per league or club (Round 5, 231–235): kind is the org''s self-description and route family; operates_competitions / operates_teams are the behaviour switches. `leagues` and `clubs` are security_invoker VIEWS over this table (235) — SELECT / UPDATE / DELETE for service_role, never INSERT.';
COMMENT ON COLUMN public.organizations.kind IS 'What the org calls itself and its route family (league | club; school later). Behaviour is the capability flags, never this.';
COMMENT ON COLUMN public.organizations.sport_key IS 'leagues.sport_key or clubs.primary_sport; nullable (a multi-sport club).';
COMMENT ON COLUMN public.organizations.location IS 'clubs'' legacy free-text location; superseded by the place block; carried so nothing is lost.';
COMMENT ON TABLE public.platform_admins IS 'Platform admin roles (222): owner | moderator. The env allowlist stays OWNER; a moderator row admits the support queue only. Written by owners only (API-enforced).';
COMMENT ON COLUMN public.post_comments.mentions IS 'Profile ids @mentioned in content, resolved server-side at POST from the author''s taggable set (public + accepted follows). Render-side, tokens are matched against these profiles'' CURRENT handles — a renamed handle degrades to plain text by design.';
COMMENT ON COLUMN public.post_comments.review_note IS 'Guardian send-back note (129). Set with status=changes_requested; cleared when the author resubmits via the scoped edit action.';
COMMENT ON COLUMN public.post_comments.approval_nudged_at IS '48h approval-nudge dedupe stamp (129). Non-null = guardians were re-belled once for this pending item.';
COMMENT ON COLUMN public.post_comments.hidden_at IS 'Hidden by moderation (223): status = ''hidden'' is what hides it; this records when.';
COMMENT ON COLUMN public.post_comments.hidden_ticket_id IS 'The ticket that hid it (223).';
COMMENT ON TABLE public.post_tags IS 'Tags linking posts to profiles (users/organizations)';
COMMENT ON COLUMN public.post_tags.media_id IS 'Optional: specific media item within the post';
COMMENT ON COLUMN public.post_tags.position_x IS 'Horizontal position percentage (0-100) for photo/video tags';
COMMENT ON COLUMN public.post_tags.position_y IS 'Vertical position percentage (0-100) for photo/video tags';
COMMENT ON COLUMN public.post_tags.status IS 'Tag status: active, pending (awaiting approval), removed (by tagged user), declined';
COMMENT ON COLUMN public.posts.saves_count IS 'Cached count of times this post has been saved';
COMMENT ON COLUMN public.posts.activity_mode IS 'Sport-agnostic post mode (e.g. round_recap, hole_highlight), scoped by sport_key. Replaces golf_mode, which is deprecated and will be dropped in a later migration.';
COMMENT ON COLUMN public.posts.post_category IS 'Cross-cutting content category (currently only ''training''), orthogonal to sport_key. NO CHECK by design — vocabulary is validated in the API (src/lib/posts/post-category.ts), the migration-020 activity_mode reasoning.';
COMMENT ON COLUMN public.posts.review_note IS 'Guardian send-back note (129). Set with status=changes_requested; cleared when the author resubmits.';
COMMENT ON COLUMN public.posts.approval_nudged_at IS '48h approval-nudge dedupe stamp (129). Non-null = guardians were re-belled once for this pending item.';
COMMENT ON COLUMN public.posts.event_id IS 'Calendar event this post was captured at (guardian batch upload, 134). Suggestion-confirmed only; SET NULL on event deletion.';
COMMENT ON COLUMN public.posts.contest_id IS 'The contest this post''s round was counted into (181). Written by the golf sync only; SET NULL on contest deletion.';
COMMENT ON COLUMN public.posts.sport_event_round_id IS 'The sport event round this post is the feed card of (203): minted at Open (announced), attached to the group_post at go-live (live), the score-led card at completion (results). ONE writer: rounds-server.ts.';
COMMENT ON COLUMN public.posts.hidden_at IS 'Hidden by moderation (223): status = ''hidden'' is what hides it (every published-only reader); this records when.';
COMMENT ON COLUMN public.posts.hidden_ticket_id IS 'The ticket that hid it (223); unhide restores published.';
COMMENT ON COLUMN public.profile_transfers.age_preset_prompt IS 'Wave 4 rider on the eligible_notified row: pending = a guardian older-preset differed at crossing time; applied/kept = guardian decision; none = no differing preset at crossing. NULL = row predates Wave 4 — never prompt retroactively.';
COMMENT ON COLUMN public.profile_transfers.handover_prompted_at IS 'Handover-moment stamp (migration 138): set once by the sweep when a supervised athlete reaches adulthood with the transfer still parked at eligible_notified. Dedup only — never a state.';
COMMENT ON COLUMN public.profiles.first_name IS 'User''s first/given name';
COMMENT ON COLUMN public.profiles.last_name IS 'User''s last/family name';
COMMENT ON COLUMN public.profiles.username IS 'Alternative username if needed';
COMMENT ON COLUMN public.profiles.full_name IS 'Username/handle for the user (e.g., johndoe, john_doe)';
COMMENT ON COLUMN public.profiles.middle_name IS 'User''s middle name (optional)';
COMMENT ON COLUMN public.profiles.cover_url IS 'Profile cover/banner image (3:1), uploaded via /api/upload/cover.';
COMMENT ON COLUMN public.profiles.equipment_prefs IS 'Equipment-tab display settings (sport order, defaults, visibility, card detail). App-validated; NULL = defaults.';
COMMENT ON COLUMN public.profiles.social_tiktok IS 'TikTok handle (raw as typed; display strips @ and links to tiktok.com/@handle)';
COMMENT ON COLUMN public.profiles.theme_prefs IS 'Account-level theme preference (mode, scheduled window, override). App-validated; NULL = light.';
COMMENT ON COLUMN public.profiles.vitals_privacy IS 'Elective Vitals hiding: {hidden, body, records, workouts}, true = private. NULL = all visible (follows profile visibility). Sanitized by /api/settings/vitals-privacy; enforced app-layer.';
COMMENT ON COLUMN public.profiles.deletion_requested_at IS 'Soft-delete park stamp (migration 128). Non-null = scheduled for hard deletion 30 days after this timestamp; cleared by restore.';
COMMENT ON COLUMN public.profiles.household_policy IS 'Per-guardian household safety defaults (132): {defaults:{visibility,messaging_permission,comment_moderation}, olderDefaults: partial|null}. NULL = not adopted. Sanitized by PATCH /api/guardian/household; applied app-layer at athlete creation and via the apply endpoint — never silently.';
COMMENT ON COLUMN public.profiles.recruiting_status IS 'The ONE recruiting gate (182): closed = nothing recruiting-facing renders; open | committed render the card and enter scout surfaces. Owner or guardian sets it (manage_settings).';
COMMENT ON COLUMN public.profiles.recruiting_profile IS 'Self-declared academics (182): { gpa, academic_notes, target_level } — parsed by src/lib/recruiting/schema.ts; never selected when recruiting_status = closed.';
COMMENT ON COLUMN public.profiles.scout_affiliation IS 'A scout account''s school or program (182, R2 writes it at signup).';
COMMENT ON COLUMN public.profiles.moderation_state IS 'Support & Reporting (223): active | limited (read-only on the content + contact routes) | suspended (until moderation_until; login refused) | banned. A single report never sets it — repeat incidents or an admin do.';
COMMENT ON COLUMN public.profiles.moderation_until IS 'When a suspension ends (223); an expired value reads as active and the daily cron lifts it.';
COMMENT ON COLUMN public.profiles.moderation_ticket_id IS 'The ticket behind the current state (223).';
COMMENT ON COLUMN public.profiles.followers_count IS '229: accepted follows where this profile is following_id. Maintained by follows_counts_sync; nullable (the row-type insert rule), read as coalesce(…, 0).';
COMMENT ON COLUMN public.profiles.following_count IS '229: accepted follows where this profile is follower_id. Maintained by follows_counts_sync; nullable, read as coalesce(…, 0).';
COMMENT ON TABLE public.risk_signals IS 'Heuristic metadata-only guardian signals (migration 137). Never derived from message content.';
COMMENT ON TABLE public.sanction_grants IS 'The append-only sanction history (167): one row per grant a parent org opened for a child (236: grantor_org_id → grantee_org_id, both organizations; revoked_at closes it). The polymorphic (grantee_kind, grantee_id) and grantor_league_id left in 237.';
COMMENT ON COLUMN public.sanction_grants.grantor_org_id IS 'The sanctioning org (236) — replaces grantor_league_id (dropped in 237).';
COMMENT ON COLUMN public.sanction_grants.grantee_org_id IS 'The sanctioned org (236) — replaces (grantee_kind, grantee_id); the kind is organizations.kind. Dropped in 237 with them.';
COMMENT ON TABLE public.saved_posts IS 'Stores bookmarked/saved posts for users';
COMMENT ON TABLE public.schema_migrations IS '226: which numbered migration files have run in THIS database. Each file inserts its own row (from 227 on); check:schema compares the head to the chain.';
COMMENT ON TABLE public.scout_shortlists IS 'A scout account''s shortlist (183): one row per athlete, a private note. Service-role + requireScout only; athletes see a count, never names.';
COMMENT ON COLUMN public.sport_event_group_members.sport_event_round_id IS 'Denormalised from the group so UNIQUE (round, participant) holds "one group per participant per round"; the writer keeps it equal to the group''s round.';
COMMENT ON COLUMN public.sport_event_group_members.side IS '1 | 2 on a match-format round (212; uniform, singles too — the engine never guesses a side from position); NULL on a stroke round.';
COMMENT ON TABLE public.sport_event_groups IS 'Playing groups per round: tee time, starting hole, ordered members. Replaced atomically by rounds-server.ts.';
COMMENT ON TABLE public.sport_event_matches IS 'One row per match (= a group with two sides on a match-format round; 212). Intent that no card can carry — concessions, sudden-death extra holes, an organizer decision, a bye — plus the outcome written ONCE at round completion. Status is computed on read, never stored. `version` is the app-level compare-and-set.';
COMMENT ON COLUMN public.sport_event_matches.concessions IS '[{hole: n | null, by_side: 1|2, by: participant_id, at}] — the side that GIVES the concession; hole null concedes the match (decided at once).';
COMMENT ON COLUMN public.sport_event_matches.extra_holes IS '[{n, hole_number, strokes: {participant_id: n | null}}] — sudden death after all square on the last; keyed by participant so four-ball keeps both balls; never in golf_hole_scores (CHECK 1..18, UNIQUE per card).';
COMMENT ON COLUMN public.sport_event_matches.version IS 'App-level CAS: every write is UPDATE … WHERE id AND version = seen; 0 rows = 409. Never trigger-bumped (the 039 lesson).';
COMMENT ON TABLE public.sport_event_media IS 'A photo / video on an event (216): by any accepted participant (followers included) or an organizer; optionally pinned to a round; posture A behind the event gate; mirrored into the round''s post at completion (mirrored_at).';
COMMENT ON COLUMN public.sport_event_media.created_by_user_id IS 'The human author when a guardian acts for a supervised uploader (the 090 attribution); NULL for a self-upload.';
COMMENT ON COLUMN public.sport_event_media.mirrored_at IS 'Stamped when the completion mirror copied this row into the round''s post (post_media, deduped on media_url); a late upload re-mirrors once.';
COMMENT ON TABLE public.sport_event_participants IS 'Who is in a sport event and how (role, status, the WHS index frozen at accept, the profile opt-out). The round''s own participants are minted from the accepted + playing rows at go-live.';
COMMENT ON COLUMN public.sport_event_participants.recorder IS 'A named recorder (214): enters scores / stats for everyone in the event; on any accepted row — a player, a co-organizer, or a follower (non-playing).';
COMMENT ON TABLE public.sport_event_rounds IS 'The rounds of a sport event (phase 1 shows one). course_id nullable — off-catalog courses are free text. hole_data keeps the stroke index (handicap) so net scoring can allocate per hole.';
COMMENT ON COLUMN public.sport_event_rounds.course_name IS 'The round''s PLACE for every sport (215): a golf course, or the rink / field / court of a team round.';
COMMENT ON COLUMN public.sport_event_rounds.name IS 'Optional label ("Saturday", "Final round"); sequence stays the order. Written by the rounds routes.';
COMMENT ON COLUMN public.sport_event_rounds.starts_at IS 'A game''s start (215); null on golf (tee times live on the groups).';
COMMENT ON COLUMN public.sport_event_rounds.side1_score IS 'The game''s live score, side 1 (215); null off a game or before the first score.';
COMMENT ON COLUMN public.sport_event_rounds.side2_score IS 'The game''s live score, side 2 (215).';
COMMENT ON COLUMN public.sport_event_rounds.period IS 'The period / half / set the game is in (215); null off a game.';
COMMENT ON COLUMN public.sport_event_rounds.score_version IS 'App-level CAS for the score write (215): UPDATE … WHERE id AND score_version = seen; 0 rows = 409. Never trigger-bumped.';
COMMENT ON COLUMN public.sport_event_rounds.timezone IS 'The round''s own IANA zone (221): its start is read on this clock; NULL = the viewer''s clock.';
COMMENT ON TABLE public.sport_event_stat_lines IS 'One row per fielded player per round of a stat-line sport (215), minted at go-live. `stats` is the whole object in the sport''s stat-schema vocabulary; `version` is the app-level compare-and-set; no status (the round''s status gates writes); no side (the group member carries it).';
COMMENT ON COLUMN public.sport_event_stat_lines.version IS 'App-level CAS: every write is UPDATE … SET stats, version = v + 1 WHERE id AND version = v; 0 rows = 409 with the current row. Never trigger-bumped (the 039 lesson).';
COMMENT ON TABLE public.sport_events IS 'An organizer-run event (phase 1: one golf round). Organizer intent — draft/open/live/completed — layered over the live round the round mints at go-live (group_posts, via 203). Posture A: service client behind resolveSportEventAccess only.';
COMMENT ON COLUMN public.sport_events.starts_on IS 'Denormalised min(sport_event_rounds.scheduled_on). ONE writer: src/lib/sport-events/rounds-server.ts.';
COMMENT ON COLUMN public.sport_events.format_config IS 'Organizer format options (207): {cut?: {after_round, top_n? | to_par?}}. Validated by src/lib/sport-events/format-config.ts parseFormatConfig; ONE writer: PATCH /api/sport-events/[id]. Reserved key: stableford (parked).';
COMMENT ON COLUMN public.sport_events.self_entry IS 'Players enter their own scores / stats (214). The recording mode is derived: self_entry + the recorder rows → self | recorder | both. Organizers always may record.';
COMMENT ON COLUMN public.sport_events.shape IS 'round (golf: hole-by-hole cards) | game (a team sport: two ad-hoc sides + a live score) | session (a team sport: one roster) — one decision at creation (215); (sport_key = golf) = (shape = round).';
COMMENT ON COLUMN public.sport_events.competition_id IS 'A bracketed MATCH event''s org golf bracket (221): kept from link time; each round''s matches are stamped onto the bracket''s contests (220) at go-live — stage n ↔ round n, slot k ↔ match k. Written only by the match-bracket path.';
COMMENT ON TABLE public.sport_settings IS 'Sport-specific settings for athlete profiles (JSONB per sport, schema-driven by src/lib/sports/settings-schemas.ts). Created live from an archived script; DDL ratified as migration 076.';
COMMENT ON TABLE public.ticket_events IS 'Support & Reporting (222): a ticket''s APPEND-ONLY history — the app never updates or deletes a row. actor NULL = the system.';
COMMENT ON COLUMN public.ticket_events.visible_to_user IS 'Whether "My requests" shows this event (222): replies and status changes yes; internal notes never.';
COMMENT ON TABLE public.tickets IS 'Support & Reporting (222): one row per help request, report or suggestion — type is a field. Posture A: service role only; the routes authorize in app code.';
COMMENT ON COLUMN public.tickets.number IS 'The human-readable ticket number (222): an identity starting at 1000, rendered EA-1000 by the app. The uuid stays the URL id.';
COMMENT ON COLUMN public.tickets.reason IS 'The report reason, help category or suggestion area (222) — validated per type in the app; one column so the queue filters on one field.';
COMMENT ON COLUMN public.tickets.reporter_email IS 'The submitter''s account email at submit time (222); NULL for a supervised reporter (the mailer routes to the guardians) and after anonymize.';
COMMENT ON COLUMN public.tickets.target_id IS 'The reported post / comment / profile / conversation / message (222). No FK on purpose: the content may be deleted — content_snapshot is the record.';
COMMENT ON COLUMN public.tickets.attachment_url IS 'An optional screenshot (Spec 3): an uploads path — registered in URL_SOURCE_COLUMNS by the PR that first writes it, or the weekly sweep deletes the file.';
COMMENT ON COLUMN public.tickets.report_count IS 'Reports merged into this ticket (222): duplicates on the same item within 7 days increment it instead of opening a new ticket (Spec 2).';
COMMENT ON COLUMN public.tickets.appeal_used_at IS 'The one appeal (222): a user reply on a resolved ticket reopens it once; stamped when used.';
COMMENT ON COLUMN public.tickets.anonymized_at IS 'Retention (222): two years after close the daily cron nulls the personal columns and stamps this.';
COMMENT ON TABLE public.user_mutes IS 'Support & Reporting (223): a user-level mute — the muted person''s posts, comments and notifications leave the muter''s view. Silent. Posture A: service role only.';
COMMENT ON COLUMN public.workout_sets.media IS 'Array of {url, type:image|video} attached to this set; max 4, API-validated.';
COMMENT ON FUNCTION public.bump_hole_score_version() IS 'BEFORE UPDATE on golf_hole_scores (209): bumps version when strokes/putts/fairway_hit/green_in_regulation/penalties change; pins it to OLD otherwise.';
COMMENT ON FUNCTION public.feed_following(p_viewer uuid, p_limit integer, p_cursor_ts timestamp with time zone, p_cursor_id uuid, p_offset integer) IS '230: one page of post ids for the following lens (self + accepted followees), newest first with the id tiebreak; the route applies the privacy filter. Service-role only.';
COMMENT ON FUNCTION public.generate_connection_suggestions(p_user_profile_id uuid, p_suggestion_limit integer) IS 'Generates personalized connection suggestions based on sport, school, location, and common connections.
Excludes: profiles already followed, pending requests, and dismissed suggestions.
Returns: suggested_id, suggested_name, suggested_avatar, suggested_sport, suggested_school, suggested_location, similarity_score, reason';
COMMENT ON FUNCTION public.get_golf_scorecard(p_group_post_id uuid) IS 'Returns complete golf scorecard with all participants and hole-by-hole scores';
COMMENT ON FUNCTION public.get_group_post_details(p_group_post_id uuid) IS 'Returns complete group post data including participants and media';
COMMENT ON FUNCTION public.provenance_inventory() IS 'Read-only pg_catalog inventory (rls, policies, functions with body checksums, triggers) for npm run check:schema. Service-role only (migration 195).';
COMMENT ON FUNCTION public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer) IS 'Atomic fixed-window rate-limit check+consume. Service-role only (migration 094).';
COMMENT ON FUNCTION public.schema_dump() IS 'Read-only pg_catalog dump of everything a blank project needs to become this one, for npm run build:baseline. Service-role only (migration 227).';
COMMENT ON FUNCTION public.search_all(q text, p_types text[], max_per_type integer, visible_ids uuid[], include_public boolean, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) IS 'Unified entity search over search_documents. Privacy is the CALLER''s job: pass the viewer''s audience via visible_ids/include_public (athletes) and filter post authors route-side.';
COMMENT ON FUNCTION public.search_golf_courses(q text, max_results integer, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) IS 'Ranked, location-aware course search over the tsvector + trigram fallback. Service-role only (104).';
COMMENT ON FUNCTION public.search_people(search_term text, visible_ids uuid[], include_public boolean, max_results integer, require_handle boolean, exclude_id uuid, p_country_code text, p_region_code text, p_near_lat double precision, p_near_lng double precision, p_radius_km double precision) IS 'Ranked people search with location tier + filters (108). Privacy is the CALLER''s job. Service-role only.';

-- ── Storage buckets ───────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('badges', 'badges', true, 1048576, ARRAY['image/png', 'image/svg+xml']::text[])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('consent-evidence', 'consent-evidence', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('uploads', 'uploads', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Realtime publication ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'golf_participant_scores') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.golf_participant_scores;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_posts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_posts;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'posts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
  END IF;
END $$;

-- ── Reference rows ────────────────────────────────────────────────────────────
INSERT INTO public.reserved_handles (handle, reason, reserved_at) VALUES
  ('about', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('account', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('activate', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('admin', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('administrator', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('api', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('app', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('apple-icon', 'Next metadata route (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('assets', 'org-subdomain infrastructure', '2026-08-31T23:54:05.514579+00:00'),
  ('athlete', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('athlete-claim', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('athletes', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('auth', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('baseball', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('basketball', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('blog', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('calendar', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('cdn', 'org-subdomain infrastructure', '2026-08-31T23:54:05.514579+00:00'),
  ('club', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('clubs', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('contact', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('dashboard', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('docs', 'org-subdomain infrastructure', '2026-08-31T23:54:05.514579+00:00'),
  ('edge', 'Brand protection', '2025-10-07T18:58:50.62396+00:00'),
  ('edgeathlete', 'Brand protection', '2025-10-07T18:58:50.62396+00:00'),
  ('edgeathletes', 'Brand protection', '2025-10-07T18:58:50.62396+00:00'),
  ('event', 'Root path (vanity namespace, 181)', '2026-09-10T16:25:51.282017+00:00'),
  ('events', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('explore', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('false', 'Technical term', '2025-10-07T18:58:50.62396+00:00'),
  ('favicon.ico', 'Root file (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('feed', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('football', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('forgot-password', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('golf', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('goodbye', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('help', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('hockey', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('home', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('icon', 'Next metadata route (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('index', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('invite', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('league', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('leagues', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('live', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('login', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('mail', 'org-subdomain infrastructure', '2026-08-31T23:54:05.514579+00:00'),
  ('manifest.webmanifest', 'Root file (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('me', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('media', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('messages', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('news', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('notifications', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('null', 'Technical term', '2025-10-07T18:58:50.62396+00:00'),
  ('official', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('onboarding', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('opengraph-image', 'Next metadata route (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('org', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('org-claim', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('preview', 'org-subdomain infrastructure', '2026-08-31T23:54:05.514579+00:00'),
  ('pricing', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('privacy', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('profile', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('register', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('reset-password', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('robots.txt', 'Root file (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('root', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('search', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('settings', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('shop', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('sign-in', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('sign-up', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('signin', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('signup', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('sitemap.xml', 'Root file (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('smtp', 'org-subdomain infrastructure', '2026-08-31T23:54:05.514579+00:00'),
  ('soccer', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('sports', 'Root path (vanity namespace, 206)', '2026-09-14T20:47:01.353725+00:00'),
  ('staff', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('staging', 'org-subdomain infrastructure', '2026-08-31T23:54:05.514579+00:00'),
  ('static', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('status', 'org-subdomain infrastructure', '2026-08-31T23:54:05.514579+00:00'),
  ('store', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('support', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('swimming', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('system', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('team', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('teams', 'Reserved word (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('tennis', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('terms', 'Root path (vanity namespace, 166)', '2026-09-01T20:08:50.000877+00:00'),
  ('trackandfield', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('true', 'Technical term', '2025-10-07T18:58:50.62396+00:00'),
  ('twitter-image', 'Next metadata route (166)', '2026-09-01T20:08:50.000877+00:00'),
  ('u', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('undefined', 'Technical term', '2025-10-07T18:58:50.62396+00:00'),
  ('user', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('users', 'System path', '2025-10-07T18:58:50.62396+00:00'),
  ('verified', 'System reserved', '2025-10-07T18:58:50.62396+00:00'),
  ('volleyball', 'Sport name', '2025-10-07T18:58:50.62396+00:00'),
  ('www', 'org-subdomain infrastructure', '2026-08-31T23:54:05.514579+00:00')
ON CONFLICT DO NOTHING;

-- ── The ledger: every chain file this rebuild embodies ────────────────────────
INSERT INTO public.schema_migrations (number, name, applied_by) VALUES
  (1, '001_initial_setup.sql', 'rebuild-000'),
  (2, '002_golf_schema.sql', 'rebuild-000'),
  (3, '003_notifications.sql', 'rebuild-000'),
  (4, '004_group_posts.sql', 'rebuild-000'),
  (5, '005_name_migration.sql', 'rebuild-000'),
  (6, '006_handles_system.sql', 'rebuild-000'),
  (7, '007_saved_posts.sql', 'rebuild-000'),
  (8, '008_tagging_system.sql', 'rebuild-000'),
  (9, '009_notification_actions.sql', 'rebuild-000'),
  (10, '010_vitals_tracking.sql', 'rebuild-000'),
  (11, '011_vitals_linked_post.sql', 'rebuild-000'),
  (12, '012_messaging.sql', 'rebuild-000'),
  (13, '013_comment_gif.sql', 'rebuild-000'),
  (14, '014_fix_notification_actor_name.sql', 'rebuild-000'),
  (15, '015_fix_like_comment_count_triggers.sql', 'rebuild-000'),
  (16, '016_comment_pinning.sql', 'rebuild-000'),
  (17, '017_message_reactions.sql', 'rebuild-000'),
  (18, '018_profile_media_sport_year_filters.sql', 'rebuild-000'),
  (19, '019_messaging_polish.sql', 'rebuild-000'),
  (20, '020_schema_cleanup_multisport.sql', 'rebuild-000'),
  (21, '021_rpc_visibility_hardening.sql', 'rebuild-000'),
  (22, '022_fix_media_counts_dropped_columns.sql', 'rebuild-000'),
  (23, '023_drop_golf_mode.sql', 'rebuild-000'),
  (24, '024_get_unread_message_count.sql', 'rebuild-000'),
  (25, '025_fix_tag_notification_trigger.sql', 'rebuild-000'),
  (26, '026_unread_count_joined_at_floor.sql', 'rebuild-000'),
  (27, '027_waitlist.sql', 'rebuild-000'),
  (28, '028_group_notification_types.sql', 'rebuild-000'),
  (29, '029_onboarding.sql', 'rebuild-000'),
  (30, '030_notification_digest.sql', 'rebuild-000'),
  (31, '031_golf_scores_realtime.sql', 'rebuild-000'),
  (32, '032_game_formats.sql', 'rebuild-000'),
  (33, '033_auto_confirm_participants.sql', 'rebuild-000'),
  (34, '034_post_pinning.sql', 'rebuild-000'),
  (35, '035_fix_group_rls_recursion.sql', 'rebuild-000'),
  (36, '036_restore_updated_at_trigger.sql', 'rebuild-000'),
  (37, '037_restore_group_trigger_functions.sql', 'rebuild-000'),
  (38, '038_realtime_publication_live_rounds.sql', 'rebuild-000'),
  (39, '039_group_round_pars_and_mirror.sql', 'rebuild-000'),
  (40, '040_security_linter_remediation.sql', 'rebuild-000'),
  (41, '041_realtime_publication_messaging.sql', 'rebuild-000'),
  (42, '042_hole_media.sql', 'rebuild-000'),
  (43, '043_achievements.sql', 'rebuild-000'),
  (44, '044_equipment_dates.sql', 'rebuild-000'),
  (45, '045_edge_vitals_workouts.sql', 'rebuild-000'),
  (46, '046_workout_set_media.sql', 'rebuild-000'),
  (47, '047_profile_cover_photo.sql', 'rebuild-000'),
  (48, '048_profile_access.sql', 'rebuild-000'),
  (49, '049_guardian_minors_foundation.sql', 'rebuild-000'),
  (50, '050_consent_records.sql', 'rebuild-000'),
  (51, '051_posts_status_approval.sql', 'rebuild-000'),
  (52, '052_rls_profile_access.sql', 'rebuild-000'),
  (53, '053_guardian_console_rpcs.sql', 'rebuild-000'),
  (54, '054_fix_handle_first_set_service_role.sql', 'rebuild-000'),
  (55, '055_profile_transfers.sql', 'rebuild-000'),
  (56, '056_consent_records_allow_fk_setnull.sql', 'rebuild-000'),
  (57, '057_calendar_events.sql', 'rebuild-000'),
  (58, '058_event_series.sql', 'rebuild-000'),
  (59, '059_calendar_sync_reminders.sql', 'rebuild-000'),
  (60, '060_hole_media_thumbnail.sql', 'rebuild-000'),
  (61, '061_media_segments.sql', 'rebuild-000'),
  (62, '062_media_highlight.sql', 'rebuild-000'),
  (63, '063_public_round_scores_rls_realtime.sql', 'rebuild-000'),
  (64, '064_equipment_group_label.sql', 'rebuild-000'),
  (65, '065_profiles_equipment_prefs.sql', 'rebuild-000'),
  (66, '066_tagged_tab_privacy_and_group_backfill.sql', 'rebuild-000'),
  (67, '067_profiles_social_tiktok.sql', 'rebuild-000'),
  (68, '068_all_stats_owner_visibility.sql', 'rebuild-000'),
  (69, '069_profiles_theme_prefs.sql', 'rebuild-000'),
  (70, '070_stats_tab_shared_rounds.sql', 'rebuild-000'),
  (71, '071_participant_position.sql', 'rebuild-000'),
  (72, '072_comment_parent_index.sql', 'rebuild-000'),
  (73, '073_comment_mentions.sql', 'rebuild-000'),
  (74, '074_statements_split.sql', 'rebuild-000'),
  (75, '075_reposts.sql', 'rebuild-000'),
  (76, '076_sport_settings_ratify_and_contract.sql', 'rebuild-000'),
  (77, '077_posts_post_category.sql', 'rebuild-000'),
  (78, '078_hole_penalties.sql', 'rebuild-000'),
  (79, '079_workout_routines.sql', 'rebuild-000'),
  (80, '080_event_workout_routine.sql', 'rebuild-000'),
  (81, '081_fix_post_tags_updated_at_trigger.sql', 'rebuild-000'),
  (82, '082_fix_empty_search_path_rpcs.sql', 'rebuild-000'),
  (83, '083_repair_unread_notification_count.sql', 'rebuild-000'),
  (84, '084_repair_group_post_rpcs.sql', 'rebuild-000'),
  (85, '085_revoke_server_rpc_grants.sql', 'rebuild-000'),
  (86, '086_revoke_handle_and_notifications_rpcs.sql', 'rebuild-000'),
  (87, '087_search_core.sql', 'rebuild-000'),
  (88, '088_drop_legacy_get_tagged_posts_overload.sql', 'rebuild-000'),
  (89, '089_guardian_notification_types.sql', 'rebuild-000'),
  (90, '090_post_attribution.sql', 'rebuild-000'),
  (91, '091_safety_settings_audit.sql', 'rebuild-000'),
  (92, '092_stat_line_date_index.sql', 'rebuild-000'),
  (93, '093_comment_attribution.sql', 'rebuild-000'),
  (94, '094_rate_limiting.sql', 'rebuild-000'),
  (95, '095_comment_moderation.sql', 'rebuild-000'),
  (96, '096_contact_messages.sql', 'rebuild-000'),
  (97, '097_parent_user_type.sql', 'rebuild-000'),
  (98, '098_guardian_follow_oversight.sql', 'rebuild-000'),
  (99, '099_golf_rounds_mirror_index_fix.sql', 'rebuild-000'),
  (100, '100_golf_courses_catalog.sql', 'rebuild-000'),
  (101, '101_golf_courses_details.sql', 'rebuild-000'),
  (102, '102_hole_geometry.sql', 'rebuild-000'),
  (103, '103_golf_courses_scale_indexes.sql', 'rebuild-000'),
  (104, '104_places_and_course_search.sql', 'rebuild-000'),
  (105, '105_backfill_course_places.sql', 'rebuild-000'),
  (106, '106_course_search_ranking.sql', 'rebuild-000'),
  (107, '107_course_search_token_ranking.sql', 'rebuild-000'),
  (108, '108_profiles_clubs_places.sql', 'rebuild-000'),
  (109, '109_place_aliases.sql', 'rebuild-000'),
  (110, '110_places_metro.sql', 'rebuild-000'),
  (111, '111_drop_dead_lower_indexes.sql', 'rebuild-000'),
  (112, '112_search_all.sql', 'rebuild-000'),
  (113, '113_leagues.sql', 'rebuild-000'),
  (114, '114_search_doc_trigger_privileges.sql', 'rebuild-000'),
  (115, '115_facets_rank_and_cap.sql', 'rebuild-000'),
  (116, '116_league_requests.sql', 'rebuild-000'),
  (117, '117_clubs_real.sql', 'rebuild-000'),
  (118, '118_league_clubs.sql', 'rebuild-000'),
  (119, '119_org_events.sql', 'rebuild-000'),
  (120, '120_post_media_source_recipe.sql', 'rebuild-000'),
  (121, '121_user_media_presets.sql', 'rebuild-000'),
  (122, '122_profiles_vitals_privacy.sql', 'rebuild-000'),
  (123, '123_hot_path_indexes.sql', 'rebuild-000'),
  (124, '124_conversation_list.sql', 'rebuild-000'),
  (125, '125_golf_clubs.sql', 'rebuild-000'),
  (126, '126_efficiency_rpcs_index_rls.sql', 'rebuild-000'),
  (127, '127_conversation_list_pagination.sql', 'rebuild-000'),
  (128, '128_soft_delete_park.sql', 'rebuild-000'),
  (129, '129_changes_requested.sql', 'rebuild-000'),
  (130, '130_consent_signature_methods.sql', 'rebuild-000'),
  (131, '131_first_contact_hold.sql', 'rebuild-000'),
  (132, '132_household_policy.sql', 'rebuild-000'),
  (133, '133_age_preset_prompt.sql', 'rebuild-000'),
  (134, '134_post_event_link.sql', 'rebuild-000'),
  (135, '135_urgent_email_tier.sql', 'rebuild-000'),
  (136, '136_last_guardian_backstop.sql', 'rebuild-000'),
  (137, '137_risk_signals.sql', 'rebuild-000'),
  (138, '138_autonomy_riders.sql', 'rebuild-000'),
  (139, '139_event_carpool.sql', 'rebuild-000'),
  (140, '140_memberships.sql', 'rebuild-000'),
  (141, '141_venues.sql', 'rebuild-000'),
  (142, '142_org_capabilities.sql', 'rebuild-000'),
  (143, '143_affiliation_type.sql', 'rebuild-000'),
  (144, '144_org_owners.sql', 'rebuild-000'),
  (145, '145_org_structure.sql', 'rebuild-000'),
  (146, '146_event_scopes.sql', 'rebuild-000'),
  (147, '147_roster_invite.sql', 'rebuild-000'),
  (148, '148_drop_legacy_member_tables.sql', 'rebuild-000'),
  (149, '149_org_wizard.sql', 'rebuild-000'),
  (150, '150_athlete_claim.sql', 'rebuild-000'),
  (151, '151_competitions.sql', 'rebuild-000'),
  (152, '152_contests.sql', 'rebuild-000'),
  (153, '153_standings.sql', 'rebuild-000'),
  (154, '154_competition_entry_notifications.sql', 'rebuild-000'),
  (155, '155_org_sites.sql', 'rebuild-000'),
  (156, '156_org_site_news.sql', 'rebuild-000'),
  (157, '157_contest_stat_lines.sql', 'rebuild-000'),
  (158, '158_contest_media.sql', 'rebuild-000'),
  (159, '159_photo_consent.sql', 'rebuild-000'),
  (160, '160_org_site_gallery.sql', 'rebuild-000'),
  (161, '161_registration_status.sql', 'rebuild-000'),
  (162, '162_registration.sql', 'rebuild-000'),
  (163, '163_registration_notifications.sql', 'rebuild-000'),
  (164, '164_org_site_register_module.sql', 'rebuild-000'),
  (165, '165_season_rollover.sql', 'rebuild-000'),
  (166, '166_reserved_root_slugs.sql', 'rebuild-000'),
  (167, '167_sanction_chain.sql', 'rebuild-000'),
  (168, '168_result_disputes.sql', 'rebuild-000'),
  (169, '169_golf_club_venues.sql', 'rebuild-000'),
  (170, '170_org_site_template_bold.sql', 'rebuild-000'),
  (171, '171_org_site_custom_domains.sql', 'rebuild-000'),
  (172, '172_golf_league_contests.sql', 'rebuild-000'),
  (173, '173_golf_league_notifications.sql', 'rebuild-000'),
  (174, '174_club_signup.sql', 'rebuild-000'),
  (175, '175_approved_at_default.sql', 'rebuild-000'),
  (176, '176_club_membership.sql', 'rebuild-000'),
  (177, '177_league_membership.sql', 'rebuild-000'),
  (178, '178_org_staff.sql', 'rebuild-000'),
  (179, '179_org_listing.sql', 'rebuild-000'),
  (180, '180_org_site_revisions.sql', 'rebuild-000'),
  (181, '181_contest_attachments.sql', 'rebuild-000'),
  (182, '182_recruiting_optin.sql', 'rebuild-000'),
  (183, '183_scout_shortlists.sql', 'rebuild-000'),
  (184, '184_recruiting_status_nullable.sql', 'rebuild-000'),
  (185, '185_org_site_pages_layout.sql', 'rebuild-000'),
  (186, '186_org_site_seo_footer.sql', 'rebuild-000'),
  (187, '187_org_site_forms.sql', 'rebuild-000'),
  (188, '188_org_site_analytics.sql', 'rebuild-000'),
  (189, '189_org_site_news_pin.sql', 'rebuild-000'),
  (190, '190_baseline_social_core.sql', 'rebuild-000'),
  (191, '191_baseline_athlete_legacy.sql', 'rebuild-000'),
  (192, '192_golf_rounds_conditions.sql', 'rebuild-000'),
  (193, '193_profiles_measurables.sql', 'rebuild-000'),
  (194, '194_athlete_performances.sql', 'rebuild-000'),
  (195, '195_provenance_inventory_rpc.sql', 'rebuild-000'),
  (196, '196_baseline_policies.sql', 'rebuild-000'),
  (197, '197_baseline_functions.sql', 'rebuild-000'),
  (198, '198_baseline_triggers.sql', 'rebuild-000'),
  (199, '199_cleanup.sql', 'rebuild-000'),
  (200, '200_hole_scores_creator_update.sql', 'rebuild-000'),
  (201, '201_sport_events_core.sql', 'rebuild-000'),
  (202, '202_sport_event_people.sql', 'rebuild-000'),
  (203, '203_sport_event_round_links.sql', 'rebuild-000'),
  (204, '204_scorecard_status.sql', 'rebuild-000'),
  (205, '205_sport_event_notifications.sql', 'rebuild-000'),
  (206, '206_reserved_sports_root.sql', 'rebuild-000'),
  (207, '207_sport_events_format_config.sql', 'rebuild-000'),
  (208, '208_notification_preferences_tag_column.sql', 'rebuild-000'),
  (209, '209_hole_score_version.sql', 'rebuild-000'),
  (210, '210_sport_event_reminder.sql', 'rebuild-000'),
  (211, '211_contests_sport_event_round.sql', 'rebuild-000'),
  (212, '212_sport_event_match_play.sql', 'rebuild-000'),
  (213, '213_sport_event_match_bell.sql', 'rebuild-000'),
  (214, '214_sport_events_open_joining_recorders.sql', 'rebuild-000'),
  (215, '215_sport_event_team_rounds.sql', 'rebuild-000'),
  (216, '216_sport_event_media.sql', 'rebuild-000'),
  (218, '218_competition_stages.sql', 'rebuild-000'),
  (219, '219_competition_entries_ad_hoc.sql', 'rebuild-000'),
  (220, '220_contests_sport_event_match.sql', 'rebuild-000'),
  (221, '221_sport_events_leftovers.sql', 'rebuild-000'),
  (222, '222_tickets.sql', 'rebuild-000'),
  (223, '223_moderation.sql', 'rebuild-000'),
  (224, '224_help_articles.sql', 'rebuild-000'),
  (225, '225_deletion_safe_fks.sql', 'rebuild-000'),
  (226, '226_schema_migrations_ledger.sql', 'rebuild-000'),
  (227, '227_schema_dump_rpc.sql', 'rebuild-000'),
  (228, '228_schema_dump_table_grants.sql', 'rebuild-000'),
  (229, '229_follow_counts_and_notification_metadata_index.sql', 'rebuild-000'),
  (230, '230_feed_following_rpc.sql', 'rebuild-000'),
  (231, '231_organizations.sql', 'rebuild-000'),
  (232, '232_org_id_generated.sql', 'rebuild-000'),
  (233, '233_org_id_flip.sql', 'rebuild-000'),
  (234, '234_org_prep.sql', 'rebuild-000'),
  (235, '235_org_drop.sql', 'rebuild-000'),
  (236, '236_org_side_tables.sql', 'rebuild-000'),
  (237, '237_org_side_tables_drop.sql', 'rebuild-000')
ON CONFLICT (number) DO NOTHING;

-- ── pg_cron jobs (review, then run by hand) ───────────────────────────────────
-- (cron.job was not readable when the dump ran — see 059 and 135 for the two jobs)

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row) ─────────────────────────────────────────────────────────
-- Expected: 000 REBUILT | 118 | 109 | 172 | 237
SELECT '000 REBUILT' AS result,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS tables_expect_118,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
          AND p.proname <> 'rls_auto_enable') AS functions_expect_109,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies_expect_172,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_237;

