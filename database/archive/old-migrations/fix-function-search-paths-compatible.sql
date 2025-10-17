-- ============================================
-- FIX FUNCTION SEARCH PATH SECURITY WARNINGS (COMPATIBLE)
-- ============================================
-- Purpose: Add search_path protection to all database functions
-- Issues Fixed: 47 "Function Search Path Mutable" warnings
-- Severity: WARN (Security)
-- Version: 2.0 (Compatible with all Postgres versions)
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
  -- Using proconfig column directly (compatible with all Postgres versions)
  SELECT COUNT(*)
  INTO functions_without_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.prosecdef = false
  AND (
    p.proconfig IS NULL OR
    NOT EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS config
      WHERE config LIKE 'search_path=%'
    )
  );

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    FUNCTION SEARCH PATH STATUS (BEFORE)';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions without search_path: %', functions_without_search_path;
  RAISE NOTICE 'Expected to fix: ~47 functions';
  RAISE NOTICE '';
END $$;

-- ============================================
-- SECTION 2: NOTIFICATION FUNCTIONS (9)
-- ============================================

DO $$
BEGIN
  -- Try to alter each function, skip if doesn't exist
  BEGIN
    ALTER FUNCTION get_unread_notification_count() SET search_path = '';
    RAISE NOTICE '✓ Fixed: get_unread_notification_count';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: get_unread_notification_count (not found)';
  END;

  BEGIN
    ALTER FUNCTION mark_all_notifications_read() SET search_path = '';
    RAISE NOTICE '✓ Fixed: mark_all_notifications_read';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: mark_all_notifications_read (not found)';
  END;

  BEGIN
    ALTER FUNCTION notify_follow_request() SET search_path = '';
    RAISE NOTICE '✓ Fixed: notify_follow_request';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: notify_follow_request (not found)';
  END;

  BEGIN
    ALTER FUNCTION notify_follow_accepted() SET search_path = '';
    RAISE NOTICE '✓ Fixed: notify_follow_accepted';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: notify_follow_accepted (not found)';
  END;

  BEGIN
    ALTER FUNCTION notify_new_follower() SET search_path = '';
    RAISE NOTICE '✓ Fixed: notify_new_follower';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: notify_new_follower (not found)';
  END;

  BEGIN
    ALTER FUNCTION notify_post_like() SET search_path = '';
    RAISE NOTICE '✓ Fixed: notify_post_like';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: notify_post_like (not found)';
  END;

  BEGIN
    ALTER FUNCTION notify_post_comment() SET search_path = '';
    RAISE NOTICE '✓ Fixed: notify_post_comment';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: notify_post_comment (not found)';
  END;

  BEGIN
    ALTER FUNCTION create_notification(UUID, UUID, TEXT, TEXT, JSONB) SET search_path = '';
    RAISE NOTICE '✓ Fixed: create_notification';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: create_notification (not found)';
  END;

  BEGIN
    ALTER FUNCTION cleanup_old_notifications() SET search_path = '';
    RAISE NOTICE '✓ Fixed: cleanup_old_notifications';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: cleanup_old_notifications (not found)';
  END;
END $$;

-- ============================================
-- SECTION 3: PROFILE & SEARCH FUNCTIONS (10)
-- ============================================

DO $$
BEGIN
  BEGIN
    ALTER FUNCTION generate_connection_suggestions(UUID, INTEGER) SET search_path = '';
    RAISE NOTICE '✓ Fixed: generate_connection_suggestions';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: generate_connection_suggestions (not found)';
  END;

  BEGIN
    ALTER FUNCTION search_profiles(TEXT, INTEGER, INTEGER) SET search_path = '';
    RAISE NOTICE '✓ Fixed: search_profiles';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: search_profiles (not found)';
  END;

  BEGIN
    ALTER FUNCTION search_clubs(TEXT, INTEGER) SET search_path = '';
    RAISE NOTICE '✓ Fixed: search_clubs';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: search_clubs (not found)';
  END;

  BEGIN
    ALTER FUNCTION search_posts(TEXT) SET search_path = '';
    RAISE NOTICE '✓ Fixed: search_posts';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: search_posts (not found)';
  END;

  BEGIN
    ALTER FUNCTION search_by_handle(TEXT, INTEGER) SET search_path = '';
    RAISE NOTICE '✓ Fixed: search_by_handle';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: search_by_handle (not found)';
  END;

  BEGIN
    ALTER FUNCTION can_view_profile(UUID, UUID) SET search_path = '';
    RAISE NOTICE '✓ Fixed: can_view_profile';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: can_view_profile (not found)';
  END;

  BEGIN
    ALTER FUNCTION sync_privacy_settings() SET search_path = '';
    RAISE NOTICE '✓ Fixed: sync_privacy_settings';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: sync_privacy_settings (not found)';
  END;

  BEGIN
    ALTER FUNCTION profiles_search_vector_update() SET search_path = '';
    RAISE NOTICE '✓ Fixed: profiles_search_vector_update';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: profiles_search_vector_update (not found)';
  END;

  BEGIN
    ALTER FUNCTION clubs_search_vector_update() SET search_path = '';
    RAISE NOTICE '✓ Fixed: clubs_search_vector_update';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: clubs_search_vector_update (not found)';
  END;

  BEGIN
    ALTER FUNCTION posts_search_vector_update() SET search_path = '';
    RAISE NOTICE '✓ Fixed: posts_search_vector_update';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: posts_search_vector_update (not found)';
  END;
END $$;

-- ============================================
-- SECTION 4: PROFILE MEDIA FUNCTIONS (4)
-- ============================================

DO $$
BEGIN
  BEGIN
    ALTER FUNCTION get_profile_all_media(UUID, INTEGER, INTEGER) SET search_path = '';
    RAISE NOTICE '✓ Fixed: get_profile_all_media';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: get_profile_all_media (not found)';
  END;

  BEGIN
    ALTER FUNCTION get_profile_stats_media(UUID, INTEGER, INTEGER) SET search_path = '';
    RAISE NOTICE '✓ Fixed: get_profile_stats_media';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: get_profile_stats_media (not found)';
  END;

  BEGIN
    ALTER FUNCTION get_profile_tagged_media(UUID, INTEGER, INTEGER) SET search_path = '';
    RAISE NOTICE '✓ Fixed: get_profile_tagged_media';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: get_profile_tagged_media (not found)';
  END;

  BEGIN
    ALTER FUNCTION get_profile_media_counts(UUID) SET search_path = '';
    RAISE NOTICE '✓ Fixed: get_profile_media_counts';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: get_profile_media_counts (not found)';
  END;
END $$;

-- ============================================
-- SECTION 5: POST INTERACTION FUNCTIONS (8)
-- ============================================

DO $$
BEGIN
  BEGIN
    ALTER FUNCTION update_post_likes_count() SET search_path = '';
    RAISE NOTICE '✓ Fixed: update_post_likes_count';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: update_post_likes_count (not found)';
  END;

  BEGIN
    ALTER FUNCTION update_post_comments_count() SET search_path = '';
    RAISE NOTICE '✓ Fixed: update_post_comments_count';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: update_post_comments_count (not found)';
  END;

  BEGIN
    ALTER FUNCTION increment_comment_likes_count() SET search_path = '';
    RAISE NOTICE '✓ Fixed: increment_comment_likes_count';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: increment_comment_likes_count (not found)';
  END;

  BEGIN
    ALTER FUNCTION decrement_comment_likes_count() SET search_path = '';
    RAISE NOTICE '✓ Fixed: decrement_comment_likes_count';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: decrement_comment_likes_count (not found)';
  END;

  BEGIN
    ALTER FUNCTION increment_post_save_count() SET search_path = '';
    RAISE NOTICE '✓ Fixed: increment_post_save_count';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: increment_post_save_count (not found)';
  END;

  BEGIN
    ALTER FUNCTION decrement_post_save_count() SET search_path = '';
    RAISE NOTICE '✓ Fixed: decrement_post_save_count';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: decrement_post_save_count (not found)';
  END;

  BEGIN
    ALTER FUNCTION get_tagged_posts(UUID) SET search_path = '';
    RAISE NOTICE '✓ Fixed: get_tagged_posts';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: get_tagged_posts (not found)';
  END;

  BEGIN
    ALTER FUNCTION notify_profile_tagged() SET search_path = '';
    RAISE NOTICE '✓ Fixed: notify_profile_tagged';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: notify_profile_tagged (not found)';
  END;
END $$;

-- ============================================
-- SECTION 6: HANDLE & NAME FUNCTIONS (6)
-- ============================================

DO $$
BEGIN
  BEGIN
    ALTER FUNCTION check_handle_availability(TEXT) SET search_path = '';
    RAISE NOTICE '✓ Fixed: check_handle_availability';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: check_handle_availability (not found)';
  END;

  BEGIN
    ALTER FUNCTION update_user_handle(UUID, TEXT) SET search_path = '';
    RAISE NOTICE '✓ Fixed: update_user_handle';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: update_user_handle (not found)';
  END;

  BEGIN
    ALTER FUNCTION is_valid_handle(TEXT) SET search_path = '';
    RAISE NOTICE '✓ Fixed: is_valid_handle';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: is_valid_handle (not found)';
  END;

  BEGIN
    ALTER FUNCTION handle_updated_at() SET search_path = '';
    RAISE NOTICE '✓ Fixed: handle_updated_at';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: handle_updated_at (not found)';
  END;

  BEGIN
    ALTER FUNCTION split_full_name(TEXT) SET search_path = '';
    RAISE NOTICE '✓ Fixed: split_full_name';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: split_full_name (not found)';
  END;

  BEGIN
    ALTER FUNCTION auto_update_display_name() SET search_path = '';
    RAISE NOTICE '✓ Fixed: auto_update_display_name';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: auto_update_display_name (not found)';
  END;
END $$;

-- ============================================
-- SECTION 7: GOLF & GROUP POSTS FUNCTIONS (5)
-- ============================================

DO $$
BEGIN
  BEGIN
    ALTER FUNCTION calculate_round_stats(UUID) SET search_path = '';
    RAISE NOTICE '✓ Fixed: calculate_round_stats';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: calculate_round_stats (not found)';
  END;

  BEGIN
    ALTER FUNCTION calculate_golf_participant_totals() SET search_path = '';
    RAISE NOTICE '✓ Fixed: calculate_golf_participant_totals';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: calculate_golf_participant_totals (not found)';
  END;

  BEGIN
    ALTER FUNCTION get_group_post_details(UUID) SET search_path = '';
    RAISE NOTICE '✓ Fixed: get_group_post_details';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: get_group_post_details (not found)';
  END;

  BEGIN
    ALTER FUNCTION get_golf_scorecard(UUID) SET search_path = '';
    RAISE NOTICE '✓ Fixed: get_golf_scorecard';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: get_golf_scorecard (not found)';
  END;

  BEGIN
    ALTER FUNCTION update_group_post_timestamp() SET search_path = '';
    RAISE NOTICE '✓ Fixed: update_group_post_timestamp';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: update_group_post_timestamp (not found)';
  END;
END $$;

-- ============================================
-- SECTION 8: UTILITY FUNCTIONS (5)
-- ============================================

DO $$
BEGIN
  BEGIN
    ALTER FUNCTION update_updated_at_column() SET search_path = '';
    RAISE NOTICE '✓ Fixed: update_updated_at_column';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: update_updated_at_column (not found)';
  END;

  BEGIN
    ALTER FUNCTION update_follows_updated_at() SET search_path = '';
    RAISE NOTICE '✓ Fixed: update_follows_updated_at';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: update_follows_updated_at (not found)';
  END;

  BEGIN
    ALTER FUNCTION update_post_tags_updated_at() SET search_path = '';
    RAISE NOTICE '✓ Fixed: update_post_tags_updated_at';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: update_post_tags_updated_at (not found)';
  END;

  BEGIN
    ALTER FUNCTION get_pending_requests_count(UUID) SET search_path = '';
    RAISE NOTICE '✓ Fixed: get_pending_requests_count';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: get_pending_requests_count (not found)';
  END;

  BEGIN
    ALTER FUNCTION handle_new_user() SET search_path = '';
    RAISE NOTICE '✓ Fixed: handle_new_user';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '⊘ Skipped: handle_new_user (not found)';
  END;
END $$;

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
  AND (
    p.proconfig IS NULL OR
    NOT EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS config
      WHERE config LIKE 'search_path=%'
    )
  );

  -- Count functions WITH search_path
  SELECT COUNT(*)
  INTO functions_with_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND EXISTS (
    SELECT 1 FROM unnest(p.proconfig) AS config
    WHERE config LIKE 'search_path=%'
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
  ELSE
    RAISE NOTICE '⚠ PARTIAL: % functions still without search_path', functions_without_search_path;
    RAISE NOTICE '  (May be built-in functions or extensions)';
  END IF;
  RAISE NOTICE '';
END $$;

-- Show list of remaining functions without search_path (if any)
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Remaining functions without search_path (if any):';
  RAISE NOTICE '';
END $$;

SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.prosecdef = false
AND (
  p.proconfig IS NULL OR
  NOT EXISTS (
    SELECT 1 FROM unnest(p.proconfig) AS config
    WHERE config LIKE 'search_path=%'
  )
)
ORDER BY p.proname
LIMIT 20;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT '✓ Function search_path security fixes applied successfully!' AS status;
SELECT '✓ This migration is compatible with all Postgres versions' AS note;
SELECT '✓ Next step: Configure auth settings in Supabase Dashboard' AS next_action;
