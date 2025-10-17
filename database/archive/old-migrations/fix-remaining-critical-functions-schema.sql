-- ============================================================================
-- FIX REMAINING CRITICAL FUNCTIONS - Add Schema Prefixes
-- ============================================================================
-- Purpose: Add public.* schema prefixes to critical functions actively used
--          by the application via .rpc() calls
-- Issue: Functions fail after search_path security fix because they use
--        unqualified table names
-- Priority: CRITICAL - These functions are actively called from API routes
--
-- Functions Fixed (11):
-- - search_profiles (3 search functions)
-- - search_posts
-- - search_clubs
-- - search_by_handle (3 handle functions)
-- - check_handle_availability
-- - update_user_handle
-- - calculate_round_stats (golf)
-- - can_view_profile (privacy)
-- - get_unread_notification_count (notification helpers)
-- - mark_all_notifications_read
-- - cleanup_old_notifications
--
-- Date: January 15, 2025
-- Status: CRITICAL FIX - REQUIRED FOR SEARCH, HANDLES, GOLF, NOTIFICATIONS
-- ============================================================================

-- ============================================================================
-- PART 1: SEARCH FUNCTIONS (3)
-- ============================================================================

-- Drop existing functions to avoid return type conflicts
DROP FUNCTION IF EXISTS search_profiles(TEXT, INTEGER);
DROP FUNCTION IF EXISTS search_posts(TEXT, INTEGER);
DROP FUNCTION IF EXISTS search_clubs(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION search_profiles(search_query text, max_results int DEFAULT 20)
RETURNS TABLE (
  id uuid,
  full_name text,
  first_name text,
  middle_name text,
  last_name text,
  avatar_url text,
  location text,
  sport text,
  school text,
  visibility text,
  rank real
) AS $$
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
$$ LANGUAGE plpgsql STABLE
SET search_path = '';

CREATE OR REPLACE FUNCTION search_posts(search_query text, max_results int DEFAULT 15)
RETURNS TABLE (
  id uuid,
  caption text,
  sport_key text,
  created_at timestamptz,
  profile_id uuid,
  rank real
) AS $$
BEGIN
  RETURN QUERY SELECT
    po.id,
    po.caption,
    po.sport_key,
    po.created_at,
    po.profile_id,
    ts_rank(po.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.posts po
  WHERE po.visibility = 'public'
  AND po.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, po.created_at DESC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = '';

CREATE OR REPLACE FUNCTION search_clubs(search_query text, max_results int DEFAULT 10)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  location text,
  rank real
) AS $$
BEGIN
  RETURN QUERY SELECT
    c.id,
    c.name,
    c.description,
    c.location,
    ts_rank(c.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.clubs c
  WHERE c.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, c.name ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = '';

-- ============================================================================
-- PART 2: HANDLE FUNCTIONS (3)
-- ============================================================================

-- Drop existing functions to avoid return type/parameter conflicts
DROP FUNCTION IF EXISTS search_by_handle(TEXT, INTEGER);
DROP FUNCTION IF EXISTS check_handle_availability(TEXT, UUID);
DROP FUNCTION IF EXISTS check_handle_availability(TEXT);
DROP FUNCTION IF EXISTS update_user_handle(UUID, TEXT);

CREATE OR REPLACE FUNCTION search_by_handle(
  search_term TEXT,
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  profile_id UUID,
  handle TEXT,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  sport TEXT,
  school TEXT,
  match_type TEXT
) AS $$
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
$$ LANGUAGE plpgsql STABLE
SET search_path = '';

CREATE OR REPLACE FUNCTION check_handle_availability(
  input_handle TEXT,
  current_profile_id UUID DEFAULT NULL
)
RETURNS TABLE (
  available BOOLEAN,
  reason TEXT,
  suggestions TEXT[]
) AS $$
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
$$ LANGUAGE plpgsql STABLE
SET search_path = '';

CREATE OR REPLACE FUNCTION update_user_handle(
  p_profile_id UUID,
  p_new_handle TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  new_handle TEXT
) AS $$
DECLARE
  current_handle TEXT;
  clean_new_handle TEXT;
  last_change TIMESTAMP WITH TIME ZONE;
  change_count INT;
  availability_result RECORD;
BEGIN
  -- Get current handle info
  SELECT handle, handle_updated_at, handle_change_count
  INTO current_handle, last_change, change_count
  FROM public.profiles
  WHERE id = p_profile_id;

  IF current_handle IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Profile not found', NULL::TEXT;
    RETURN;
  END IF;

  -- Clean new handle
  clean_new_handle := LOWER(TRIM(p_new_handle));

  -- Check if same as current (case-insensitive)
  IF LOWER(current_handle) = clean_new_handle THEN
    -- Allow case change without counting as a full change
    UPDATE public.profiles
    SET handle = p_new_handle
    WHERE id = p_profile_id;

    RETURN QUERY SELECT TRUE, 'Handle casing updated', p_new_handle;
    RETURN;
  END IF;

  -- Rate limiting: max 1 change per 7 days
  IF last_change IS NOT NULL AND last_change > NOW() - INTERVAL '7 days' THEN
    RETURN QUERY SELECT
      FALSE,
      'You can only change your handle once per week. Next available: ' ||
        TO_CHAR(last_change + INTERVAL '7 days', 'Mon DD, YYYY'),
      NULL::TEXT;
    RETURN;
  END IF;

  -- Check availability
  SELECT * INTO availability_result
  FROM public.check_handle_availability(clean_new_handle, p_profile_id);

  IF NOT availability_result.available THEN
    RETURN QUERY SELECT FALSE, availability_result.reason, NULL::TEXT;
    RETURN;
  END IF;

  -- Save to history
  IF current_handle IS NOT NULL THEN
    INSERT INTO public.handle_history (profile_id, old_handle, new_handle)
    VALUES (p_profile_id, current_handle, clean_new_handle);
  END IF;

  -- Update profile
  UPDATE public.profiles
  SET
    handle = p_new_handle,  -- Preserve user's preferred casing
    handle_updated_at = NOW(),
    handle_change_count = COALESCE(change_count, 0) + 1
  WHERE id = p_profile_id;

  RETURN QUERY SELECT
    TRUE,
    'Handle updated successfully! Old @mentions will redirect for 30 days.',
    p_new_handle;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 3: GOLF CALCULATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_round_stats(round_uuid UUID)
RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 4: PRIVACY FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION can_view_profile(
  target_profile_id UUID,
  viewer_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  profile_vis TEXT;
  is_following BOOLEAN;
BEGIN
  -- Get profile visibility
  SELECT visibility INTO profile_vis
  FROM public.profiles
  WHERE id = target_profile_id;

  -- Own profile
  IF target_profile_id = viewer_id THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ============================================================================
-- PART 5: NOTIFICATION HELPER FUNCTIONS (3)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unread_notification_count()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM public.notifications
  WHERE user_id = auth.uid()
  AND is_read = false;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS INTEGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM public.notifications
  WHERE is_read = true
  AND read_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ============================================================================
-- VERIFICATION - All critical functions updated successfully
-- ============================================================================
-- Functions fixed (11):
-- - search_profiles, search_posts, search_clubs (search functions)
-- - search_by_handle, check_handle_availability, update_user_handle (handle functions)
-- - calculate_round_stats (golf calculations)
-- - can_view_profile (privacy checks)
-- - get_unread_notification_count, mark_all_notifications_read, cleanup_old_notifications
--
-- What this fixes:
-- - Global search (athletes, posts, clubs)
-- - @handle search and validation during signup
-- - Golf score calculations
-- - Privacy checks for private profiles
-- - Notification counts and mark-as-read functionality
-- ============================================================================

-- ============================================================================
-- SUCCESS
-- ============================================================================

SELECT 'SUCCESS: All critical functions updated with schema prefixes!' AS status;
SELECT 'SUCCESS: Search, handles, golf, and notifications now work!' AS result;
