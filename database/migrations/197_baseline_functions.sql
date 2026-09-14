-- ============================================================================
-- 197: BASELINE — every live function body the chain does not own, recorded
--      (provenance round, PR D — Sep 15 2026)
-- ============================================================================
-- The first live run of the function facet (migration 195's catalog,
-- database/provenance/dumps/2026-09-14-catalog.json) found, over 107
-- public non-extension functions: 5 no numbered file defines, 8 whose
-- LIVE BODY differs from the chain's last definition (none of them
-- whitespace-only), and 9 whose live search_path is '' while the chain's
-- definition sets none — every one of those set by an archived
-- linter-remediation script. Tom's rule for this round: the body checksum
-- must match, and a baseline records LIVE. So this file re-declares each of
-- the 13 functions EXACTLY as pg_get_functiondef prints it today (its own
-- dollar-quote tag — never named in a comment: an odd number of tags in a
-- file confuses a client-side statement splitter, which is how the first
-- run of this file died at "relation total_strokes" — the identity with
-- argument names and defaults, SECURITY
-- and search_path included — a CREATE OR REPLACE whose body md5 equals the
-- live md5(prosrc) is a no-op), reproduces its live EXECUTE grants from
-- proacl, and pins the one config-only drift with ALTER FUNCTION. Never a
-- DROP FUNCTION. A NO-OP on production, re-runnable; the check grid compares
-- md5(prosrc) per function against the recorded value and reads the same
-- before and after.
--
-- What the chain had wrong, function by function (the header is the record;
-- the code below is live truth):
--   * calculate_round_stats(uuid)
--     live also sums par (total_par, COALESCE(SUM(par), 0)) — the par fix in features/golf/fix-golf-par-calculation.sql, never numbered
--   * check_handle_availability(text,uuid)
--     live inlines the format check instead of calling is_valid_handle() (archive/old-migrations/fix-remaining-critical-functions-schema.sql)
--   * cleanup_old_notifications()
--     public.notifications schema-qualified (archive/old-migrations/fix-notification-functions-schema-qualified.sql)
--   * create_notification(uuid,text,uuid,text,text,text,uuid,uuid,uuid,jsonb)
--     public.notification_preferences / public.notifications schema-qualified (the same archived file)
--   * decrement_post_save_count()
--     UPDATE public.posts schema-qualified (archive/old-migrations/fix-utility-functions-schema.sql)
--   * generate_connection_suggestions(uuid,integer)
--     never numbered — archive/failed-attempts/implement-notifications-system.sql — the one of the five the app calls (/api/suggestions, service role)
--   * get_pending_requests_count(uuid)
--     never numbered — archive/failed-attempts/implement-notifications-system.sql
--   * handle_new_user()
--     live writes full_name from raw_user_meta_data and ON CONFLICT (id) DO NOTHING; 001 wrote user_type (archive/old-migrations/fix-utility-functions-schema.sql) — the signup path the app relies on
--   * increment_post_save_count()
--     UPDATE public.posts schema-qualified (archive/old-migrations/fix-utility-functions-schema.sql)
--   * mark_all_notifications_read()
--     never numbered — archive/failed-attempts/implement-notifications-system.sql
--   * mark_all_notifications_read(uuid)
--     never numbered — archive/failed-attempts/implement-notifications-minimal.sql
--   * search_by_handle(text,integer)
--     FROM public.profiles schema-qualified (archive/old-migrations/fix-function-search-paths.sql)
--   * search_profiles(text,integer)
--     never numbered — archive/old-migrations/fix-function-search-paths.sql
--   * is_valid_handle(text) — search_path '' live (archive/old-migrations/fix-function-search-paths.sql), body already matches 006
--
-- Recorded as found — a later migration may decide:
--   * mark_all_notifications_read exists TWICE live, () and (uuid), from two
--     archived notification attempts; both are service-role only. The app
--     calls neither directly (the notifications routes update rows).
--   * decrement_post_save_count(), increment_post_save_count() and
--     is_valid_handle(text) are EXECUTE-granted to PUBLIC live (the two
--     save-count functions are trigger functions — PostgREST cannot call a
--     function that RETURNS trigger; is_valid_handle is a pure validator).
--     Every other function here is postgres + service_role only.
--   * calculate_round_stats(uuid) — the live body is the one with the par
--     sum; 002's is the pre-fix one. The fix's own file under features/golf/
--     stays as history.
--   * handle_new_user() — the live body is the signup path that COALESCEs
--     full_name from the auth metadata and tolerates a re-fired trigger.
-- After this file the allowlist is still EMPTY and `npm run check:schema`
-- is OK on every facet.
-- ============================================================================

-- ── calculate_round_stats(uuid)
-- drift — live also sums par (total_par, COALESCE(SUM(par), 0)) — the par fix in features/golf/fix-golf-par-calculation.sql, never numbered
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
REVOKE EXECUTE ON FUNCTION public.calculate_round_stats(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_round_stats(uuid) TO service_role;

-- ── check_handle_availability(text,uuid)
-- drift — live inlines the format check instead of calling is_valid_handle() (archive/old-migrations/fix-remaining-critical-functions-schema.sql)
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
REVOKE EXECUTE ON FUNCTION public.check_handle_availability(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_handle_availability(text, uuid) TO service_role;

-- ── cleanup_old_notifications()
-- drift — public.notifications schema-qualified (archive/old-migrations/fix-notification-functions-schema-qualified.sql)
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
REVOKE EXECUTE ON FUNCTION public.cleanup_old_notifications() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications() TO service_role;

-- ── create_notification(uuid,text,uuid,text,text,text,uuid,uuid,uuid,jsonb)
-- drift — public.notification_preferences / public.notifications schema-qualified (the same archived file)
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
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, uuid, text, text, text, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, uuid, text, text, text, uuid, uuid, uuid, jsonb) TO service_role;

-- ── decrement_post_save_count()
-- drift — UPDATE public.posts schema-qualified (archive/old-migrations/fix-utility-functions-schema.sql)
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
REVOKE EXECUTE ON FUNCTION public.decrement_post_save_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_post_save_count() TO PUBLIC, anon, authenticated, service_role;

-- ── generate_connection_suggestions(uuid,integer)
-- unowned — archive/failed-attempts/implement-notifications-system.sql — the one of the five the app calls (/api/suggestions, service role)
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
REVOKE EXECUTE ON FUNCTION public.generate_connection_suggestions(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_connection_suggestions(uuid, integer) TO service_role;

-- ── get_pending_requests_count(uuid)
-- unowned — archive/failed-attempts/implement-notifications-system.sql
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
REVOKE EXECUTE ON FUNCTION public.get_pending_requests_count(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_requests_count(uuid) TO service_role;

-- ── handle_new_user()
-- drift — live writes full_name from raw_user_meta_data and ON CONFLICT (id) DO NOTHING; 001 wrote user_type (archive/old-migrations/fix-utility-functions-schema.sql) — the signup path the app relies on
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
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- ── increment_post_save_count()
-- drift — UPDATE public.posts schema-qualified (archive/old-migrations/fix-utility-functions-schema.sql)
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
REVOKE EXECUTE ON FUNCTION public.increment_post_save_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_post_save_count() TO PUBLIC, anon, authenticated, service_role;

-- ── mark_all_notifications_read()
-- unowned — archive/failed-attempts/implement-notifications-system.sql
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE public.notifications
  SET
    is_read = true,
    read_at = NOW(),
    updated_at = NOW()
  WHERE user_id = auth.uid()
  AND is_read = false;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO service_role;

-- ── mark_all_notifications_read(uuid)
-- unowned — archive/failed-attempts/implement-notifications-minimal.sql
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE notifications
  SET read = TRUE, read_at = NOW()
  WHERE recipient_id = user_id AND read = FALSE;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO service_role;

-- ── search_by_handle(text,integer)
-- drift — FROM public.profiles schema-qualified (archive/old-migrations/fix-function-search-paths.sql)
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
REVOKE EXECUTE ON FUNCTION public.search_by_handle(text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_by_handle(text, integer) TO service_role;

-- ── search_profiles(text,integer)
-- unowned — archive/old-migrations/fix-function-search-paths.sql
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
REVOKE EXECUTE ON FUNCTION public.search_profiles(text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_profiles(text, integer) TO service_role;

-- ── search_path only (the body already matches the chain) ─────────────────
ALTER FUNCTION public.is_valid_handle(text) SET search_path = '';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'calculate_round_stats(uuid): body' AS check_name, '83b88b678b299fd21f978a5caa350da0' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '83b88b678b299fd21f978a5caa350da0' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'calculate_round_stats' AND oidvectortypes(proargtypes) = 'uuid'
UNION ALL

SELECT 'check_handle_availability(text, uuid): body' AS check_name, '274a605c593408e4bbaa45b663ed1514' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '274a605c593408e4bbaa45b663ed1514' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'check_handle_availability' AND oidvectortypes(proargtypes) = 'text, uuid'
UNION ALL

SELECT 'cleanup_old_notifications(): body' AS check_name, 'fea721d22374be850a673db5fd77a5a5' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'fea721d22374be850a673db5fd77a5a5' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'cleanup_old_notifications' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'create_notification(uuid, text, uuid, text, text, text, uuid, uuid, uuid, jsonb): body' AS check_name, '2c8cdd7b391261b170eac4605a145c85' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '2c8cdd7b391261b170eac4605a145c85' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'create_notification' AND oidvectortypes(proargtypes) = 'uuid, text, uuid, text, text, text, uuid, uuid, uuid, jsonb'
UNION ALL

SELECT 'decrement_post_save_count(): body' AS check_name, '0ddf4c7af0b785155db701240f7effeb' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '0ddf4c7af0b785155db701240f7effeb' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'decrement_post_save_count' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'generate_connection_suggestions(uuid, integer): body' AS check_name, 'bd6e95085aa62c2414ba920d45c6b748' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'bd6e95085aa62c2414ba920d45c6b748' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'generate_connection_suggestions' AND oidvectortypes(proargtypes) = 'uuid, integer'
UNION ALL

SELECT 'get_pending_requests_count(uuid): body' AS check_name, '372d1116dae84878a526816d34bc1440' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '372d1116dae84878a526816d34bc1440' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_pending_requests_count' AND oidvectortypes(proargtypes) = 'uuid'
UNION ALL

SELECT 'handle_new_user(): body' AS check_name, '75c33bab4aa62349e1d043640df1623e' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '75c33bab4aa62349e1d043640df1623e' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'handle_new_user' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'increment_post_save_count(): body' AS check_name, 'c6efc4003f486b340df16b5b2539cc02' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'c6efc4003f486b340df16b5b2539cc02' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'increment_post_save_count' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'mark_all_notifications_read(): body' AS check_name, 'a459f630ffeaba6de7a6e43f6dc13d41' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'a459f630ffeaba6de7a6e43f6dc13d41' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'mark_all_notifications_read' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'mark_all_notifications_read(uuid): body' AS check_name, '771b23444279d4aecec0511f86dd600f' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '771b23444279d4aecec0511f86dd600f' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'mark_all_notifications_read' AND oidvectortypes(proargtypes) = 'uuid'
UNION ALL

SELECT 'search_by_handle(text, integer): body' AS check_name, 'f360bb3eed139082f1e85aab1f3f9efa' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'f360bb3eed139082f1e85aab1f3f9efa' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'search_by_handle' AND oidvectortypes(proargtypes) = 'text, integer'
UNION ALL

SELECT 'search_profiles(text, integer): body' AS check_name, '789f8442ff0220d33b923051ba8d8064' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '789f8442ff0220d33b923051ba8d8064' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'search_profiles' AND oidvectortypes(proargtypes) = 'text, integer'
UNION ALL

SELECT 'is_valid_handle(text): search_path', 'search_path=""', COALESCE(array_to_string(proconfig, ';'), '-'),
       CASE WHEN 'search_path=""' = ANY (proconfig) THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'is_valid_handle' AND oidvectortypes(proargtypes) = 'text'
UNION ALL

SELECT 'anon cannot execute the service-only ones', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND (proname, oidvectortypes(proargtypes)) IN (('calculate_round_stats', 'uuid'), ('check_handle_availability', 'text, uuid'), ('cleanup_old_notifications', ''), ('create_notification', 'uuid, text, uuid, text, text, text, uuid, uuid, uuid, jsonb'), ('generate_connection_suggestions', 'uuid, integer'), ('get_pending_requests_count', 'uuid'), ('handle_new_user', ''), ('mark_all_notifications_read', ''), ('mark_all_notifications_read', 'uuid'), ('search_by_handle', 'text, integer'), ('search_profiles', 'text, integer'))
   AND has_function_privilege('anon', oid, 'EXECUTE')
UNION ALL

SELECT 'public non-extension functions', '107', count(*)::text,
       CASE WHEN count(*) = 107 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM pg_depend x WHERE x.classid = 'pg_proc'::regclass AND x.objid = p.oid AND x.deptype = 'e')

ORDER BY 1;
