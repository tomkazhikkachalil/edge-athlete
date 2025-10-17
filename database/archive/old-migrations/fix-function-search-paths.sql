-- ============================================
-- FIX FUNCTION SEARCH PATH SECURITY WARNINGS
-- ============================================
-- Purpose: Add search_path protection to all database functions
-- Issues Fixed: 47 "Function Search Path Mutable" warnings
-- Severity: WARN (Security)
-- Created: 2025-01-15
--
-- What this fixes:
-- Functions without SET search_path are vulnerable to SQL injection
-- via schema search path manipulation. This migration secures all
-- exposed functions by setting search_path = '' (empty).
--
-- Reference: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
-- ============================================

-- ============================================
-- SECTION 1: VERIFICATION (BEFORE)
-- ============================================

DO $$
DECLARE
  functions_without_search_path INTEGER;
BEGIN
  -- Count functions in public schema without search_path set
  SELECT COUNT(*)
  INTO functions_without_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.prosecdef = false
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc_config(p.oid) WHERE split_part(unnest, '=', 1) = 'search_path'
  );

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    FUNCTION SEARCH PATH STATUS (BEFORE)';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions without search_path: %', functions_without_search_path;
  RAISE NOTICE 'Expected to fix: 47 functions';
  RAISE NOTICE '';
END $$;

-- ============================================
-- SECTION 2: NOTIFICATION FUNCTIONS (9)
-- ============================================

ALTER FUNCTION get_unread_notification_count() SET search_path = '';
ALTER FUNCTION mark_all_notifications_read() SET search_path = '';
ALTER FUNCTION notify_follow_request() SET search_path = '';
ALTER FUNCTION notify_follow_accepted() SET search_path = '';
ALTER FUNCTION notify_new_follower() SET search_path = '';
ALTER FUNCTION notify_post_like() SET search_path = '';
ALTER FUNCTION notify_post_comment() SET search_path = '';
ALTER FUNCTION create_notification(UUID, UUID, TEXT, TEXT, JSONB) SET search_path = '';
ALTER FUNCTION cleanup_old_notifications() SET search_path = '';

COMMENT ON FUNCTION get_unread_notification_count IS 'Returns count of unread notifications for current user (search_path protected)';
COMMENT ON FUNCTION mark_all_notifications_read IS 'Marks all notifications as read for current user (search_path protected)';
COMMENT ON FUNCTION notify_follow_request IS 'Creates notification for follow request (search_path protected)';
COMMENT ON FUNCTION notify_follow_accepted IS 'Creates notification when follow is accepted (search_path protected)';
COMMENT ON FUNCTION notify_new_follower IS 'Creates notification for new follower (search_path protected)';
COMMENT ON FUNCTION notify_post_like IS 'Creates notification when post is liked (search_path protected)';
COMMENT ON FUNCTION notify_post_comment IS 'Creates notification for new comment (search_path protected)';
COMMENT ON FUNCTION create_notification IS 'Generic notification creator (search_path protected)';
COMMENT ON FUNCTION cleanup_old_notifications IS 'Removes old read notifications (search_path protected)';

-- ============================================
-- SECTION 3: PROFILE & SEARCH FUNCTIONS (10)
-- ============================================

ALTER FUNCTION generate_connection_suggestions(UUID, INTEGER) SET search_path = '';
ALTER FUNCTION search_profiles(TEXT, INTEGER, INTEGER) SET search_path = '';
ALTER FUNCTION search_clubs(TEXT, INTEGER) SET search_path = '';
ALTER FUNCTION search_posts(TEXT) SET search_path = '';
ALTER FUNCTION search_by_handle(TEXT, INTEGER) SET search_path = '';
ALTER FUNCTION can_view_profile(UUID, UUID) SET search_path = '';
ALTER FUNCTION sync_privacy_settings() SET search_path = '';
ALTER FUNCTION profiles_search_vector_update() SET search_path = '';
ALTER FUNCTION clubs_search_vector_update() SET search_path = '';
ALTER FUNCTION posts_search_vector_update() SET search_path = '';

COMMENT ON FUNCTION generate_connection_suggestions IS 'Generates athlete connection suggestions (search_path protected)';
COMMENT ON FUNCTION search_profiles IS 'Full-text search for profiles (search_path protected)';
COMMENT ON FUNCTION search_clubs IS 'Full-text search for clubs (search_path protected)';
COMMENT ON FUNCTION search_posts IS 'Full-text search for posts (search_path protected)';
COMMENT ON FUNCTION search_by_handle IS 'Search profiles by handle (search_path protected)';
COMMENT ON FUNCTION can_view_profile IS 'Check if user can view private profile (search_path protected)';
COMMENT ON FUNCTION sync_privacy_settings IS 'Syncs privacy settings across tables (search_path protected)';
COMMENT ON FUNCTION profiles_search_vector_update IS 'Updates profile search vector (search_path protected)';
COMMENT ON FUNCTION clubs_search_vector_update IS 'Updates club search vector (search_path protected)';
COMMENT ON FUNCTION posts_search_vector_update IS 'Updates post search vector (search_path protected)';

-- ============================================
-- SECTION 4: PROFILE MEDIA FUNCTIONS (4)
-- ============================================

ALTER FUNCTION get_profile_all_media(UUID, INTEGER, INTEGER) SET search_path = '';
ALTER FUNCTION get_profile_stats_media(UUID, INTEGER, INTEGER) SET search_path = '';
ALTER FUNCTION get_profile_tagged_media(UUID, INTEGER, INTEGER) SET search_path = '';
ALTER FUNCTION get_profile_media_counts(UUID) SET search_path = '';

COMMENT ON FUNCTION get_profile_all_media IS 'Gets all media posts for profile (search_path protected)';
COMMENT ON FUNCTION get_profile_stats_media IS 'Gets posts with stats for profile (search_path protected)';
COMMENT ON FUNCTION get_profile_tagged_media IS 'Gets posts where profile is tagged (search_path protected)';
COMMENT ON FUNCTION get_profile_media_counts IS 'Gets media counts by tab for profile (search_path protected)';

-- ============================================
-- SECTION 5: POST INTERACTION FUNCTIONS (8)
-- ============================================

ALTER FUNCTION update_post_likes_count() SET search_path = '';
ALTER FUNCTION update_post_comments_count() SET search_path = '';
ALTER FUNCTION increment_comment_likes_count() SET search_path = '';
ALTER FUNCTION decrement_comment_likes_count() SET search_path = '';
ALTER FUNCTION increment_post_save_count() SET search_path = '';
ALTER FUNCTION decrement_post_save_count() SET search_path = '';
ALTER FUNCTION get_tagged_posts(UUID) SET search_path = '';
ALTER FUNCTION notify_profile_tagged() SET search_path = '';

COMMENT ON FUNCTION update_post_likes_count IS 'Updates post likes count (search_path protected)';
COMMENT ON FUNCTION update_post_comments_count IS 'Updates post comments count (search_path protected)';
COMMENT ON FUNCTION increment_comment_likes_count IS 'Increments comment likes count (search_path protected)';
COMMENT ON FUNCTION decrement_comment_likes_count IS 'Decrements comment likes count (search_path protected)';
COMMENT ON FUNCTION increment_post_save_count IS 'Increments post save count (search_path protected)';
COMMENT ON FUNCTION decrement_post_save_count IS 'Decrements post save count (search_path protected)';
COMMENT ON FUNCTION get_tagged_posts IS 'Gets posts where user is tagged (search_path protected)';
COMMENT ON FUNCTION notify_profile_tagged IS 'Notifies user when tagged (search_path protected)';

-- ============================================
-- SECTION 6: HANDLE & NAME FUNCTIONS (6)
-- ============================================

ALTER FUNCTION check_handle_availability(TEXT) SET search_path = '';
ALTER FUNCTION update_user_handle(UUID, TEXT) SET search_path = '';
ALTER FUNCTION is_valid_handle(TEXT) SET search_path = '';
ALTER FUNCTION handle_updated_at() SET search_path = '';
ALTER FUNCTION split_full_name(TEXT) SET search_path = '';
ALTER FUNCTION auto_update_display_name() SET search_path = '';

COMMENT ON FUNCTION check_handle_availability IS 'Checks if handle is available (search_path protected)';
COMMENT ON FUNCTION update_user_handle IS 'Updates user handle (search_path protected)';
COMMENT ON FUNCTION is_valid_handle IS 'Validates handle format (search_path protected)';
COMMENT ON FUNCTION handle_updated_at IS 'Updates handle timestamp trigger (search_path protected)';
COMMENT ON FUNCTION split_full_name IS 'Splits full name into parts (search_path protected)';
COMMENT ON FUNCTION auto_update_display_name IS 'Auto-updates display name (search_path protected)';

-- ============================================
-- SECTION 7: GOLF & GROUP POSTS FUNCTIONS (5)
-- ============================================

ALTER FUNCTION calculate_round_stats(UUID) SET search_path = '';
ALTER FUNCTION calculate_golf_participant_totals() SET search_path = '';
ALTER FUNCTION get_group_post_details(UUID) SET search_path = '';
ALTER FUNCTION get_golf_scorecard(UUID) SET search_path = '';
ALTER FUNCTION update_group_post_timestamp() SET search_path = '';

COMMENT ON FUNCTION calculate_round_stats IS 'Calculates golf round statistics (search_path protected)';
COMMENT ON FUNCTION calculate_golf_participant_totals IS 'Calculates participant golf totals (search_path protected)';
COMMENT ON FUNCTION get_group_post_details IS 'Gets complete group post data (search_path protected)';
COMMENT ON FUNCTION get_golf_scorecard IS 'Gets golf scorecard with all scores (search_path protected)';
COMMENT ON FUNCTION update_group_post_timestamp IS 'Updates group post timestamp (search_path protected)';

-- ============================================
-- SECTION 8: UTILITY FUNCTIONS (5)
-- ============================================

ALTER FUNCTION update_updated_at_column() SET search_path = '';
ALTER FUNCTION update_follows_updated_at() SET search_path = '';
ALTER FUNCTION update_post_tags_updated_at() SET search_path = '';
ALTER FUNCTION get_pending_requests_count(UUID) SET search_path = '';
ALTER FUNCTION handle_new_user() SET search_path = '';

COMMENT ON FUNCTION update_updated_at_column IS 'Generic updated_at trigger (search_path protected)';
COMMENT ON FUNCTION update_follows_updated_at IS 'Updates follows timestamp (search_path protected)';
COMMENT ON FUNCTION update_post_tags_updated_at IS 'Updates post tags timestamp (search_path protected)';
COMMENT ON FUNCTION get_pending_requests_count IS 'Gets pending follow requests count (search_path protected)';
COMMENT ON FUNCTION handle_new_user IS 'Handles new user creation trigger (search_path protected)';

-- ============================================
-- SECTION 9: VERIFICATION (AFTER)
-- ============================================

DO $$
DECLARE
  functions_without_search_path INTEGER;
  functions_with_search_path INTEGER;
  total_public_functions INTEGER;
BEGIN
  -- Count functions WITHOUT search_path
  SELECT COUNT(*)
  INTO functions_without_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.prosecdef = false
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc_config(p.oid) WHERE split_part(unnest, '=', 1) = 'search_path'
  );

  -- Count functions WITH search_path
  SELECT COUNT(*)
  INTO functions_with_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND EXISTS (
    SELECT 1 FROM pg_proc_config(p.oid) WHERE split_part(unnest, '=', 1) = 'search_path'
  );

  -- Total functions
  SELECT COUNT(*)
  INTO total_public_functions
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public';

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    FUNCTION SEARCH PATH STATUS (AFTER)';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Total public functions: %', total_public_functions;
  RAISE NOTICE 'Functions WITH search_path: %', functions_with_search_path;
  RAISE NOTICE 'Functions WITHOUT search_path: %', functions_without_search_path;
  RAISE NOTICE '';

  IF functions_without_search_path = 0 THEN
    RAISE NOTICE '✓ SUCCESS: All functions are now protected!';
    RAISE NOTICE '✓ Supabase Advisor should show 0 search_path warnings';
  ELSIF functions_without_search_path < 47 THEN
    RAISE NOTICE '⚠ PARTIAL: % functions still need fixing', functions_without_search_path;
    RAISE NOTICE '  (Some functions may not exist in your database)';
  ELSE
    RAISE NOTICE '⚠ WARNING: % functions still missing search_path', functions_without_search_path;
  END IF;
  RAISE NOTICE '';
END $$;

-- Show list of any remaining functions without search_path
SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.prosecdef = false
AND NOT EXISTS (
  SELECT 1 FROM pg_proc_config(p.oid) WHERE split_part(unnest, '=', 1) = 'search_path'
)
ORDER BY p.proname;

-- ============================================
-- SECTION 10: ROLLBACK (IF NEEDED)
-- ============================================
-- Run these commands if you need to undo the changes
-- (Keep commented - for reference only)

/*
-- Rollback: Remove search_path from all functions
-- NOTE: Only do this if absolutely necessary!

ALTER FUNCTION get_unread_notification_count() RESET search_path;
ALTER FUNCTION mark_all_notifications_read() RESET search_path;
ALTER FUNCTION notify_follow_request() RESET search_path;
ALTER FUNCTION notify_follow_accepted() RESET search_path;
ALTER FUNCTION notify_new_follower() RESET search_path;
ALTER FUNCTION notify_post_like() RESET search_path;
ALTER FUNCTION notify_post_comment() RESET search_path;
ALTER FUNCTION create_notification RESET search_path;
ALTER FUNCTION cleanup_old_notifications() RESET search_path;

ALTER FUNCTION generate_connection_suggestions RESET search_path;
ALTER FUNCTION search_profiles RESET search_path;
ALTER FUNCTION search_clubs RESET search_path;
ALTER FUNCTION search_posts RESET search_path;
ALTER FUNCTION search_by_handle RESET search_path;
ALTER FUNCTION can_view_profile RESET search_path;
ALTER FUNCTION sync_privacy_settings() RESET search_path;
ALTER FUNCTION profiles_search_vector_update() RESET search_path;
ALTER FUNCTION clubs_search_vector_update() RESET search_path;
ALTER FUNCTION posts_search_vector_update() RESET search_path;

ALTER FUNCTION get_profile_all_media RESET search_path;
ALTER FUNCTION get_profile_stats_media RESET search_path;
ALTER FUNCTION get_profile_tagged_media RESET search_path;
ALTER FUNCTION get_profile_media_counts RESET search_path;

ALTER FUNCTION update_post_likes_count() RESET search_path;
ALTER FUNCTION update_post_comments_count() RESET search_path;
ALTER FUNCTION increment_comment_likes_count() RESET search_path;
ALTER FUNCTION decrement_comment_likes_count() RESET search_path;
ALTER FUNCTION increment_post_save_count() RESET search_path;
ALTER FUNCTION decrement_post_save_count() RESET search_path;
ALTER FUNCTION get_tagged_posts RESET search_path;
ALTER FUNCTION notify_profile_tagged() RESET search_path;

ALTER FUNCTION check_handle_availability RESET search_path;
ALTER FUNCTION update_user_handle RESET search_path;
ALTER FUNCTION is_valid_handle RESET search_path;
ALTER FUNCTION handle_updated_at() RESET search_path;
ALTER FUNCTION split_full_name RESET search_path;
ALTER FUNCTION auto_update_display_name() RESET search_path;

ALTER FUNCTION calculate_round_stats RESET search_path;
ALTER FUNCTION calculate_golf_participant_totals() RESET search_path;
ALTER FUNCTION get_group_post_details RESET search_path;
ALTER FUNCTION get_golf_scorecard RESET search_path;
ALTER FUNCTION update_group_post_timestamp() RESET search_path;

ALTER FUNCTION update_updated_at_column() RESET search_path;
ALTER FUNCTION update_follows_updated_at() RESET search_path;
ALTER FUNCTION update_post_tags_updated_at() RESET search_path;
ALTER FUNCTION get_pending_requests_count RESET search_path;
ALTER FUNCTION handle_new_user() RESET search_path;
*/

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT '✓ Function search_path security fixes applied successfully!' AS status;
SELECT '✓ Next step: Configure auth settings in Supabase Dashboard' AS next_action;
SELECT '✓ See FIX_FUNCTION_SEARCH_PATHS.md for complete instructions' AS documentation;
