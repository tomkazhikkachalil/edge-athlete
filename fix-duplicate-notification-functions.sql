-- =====================================================
-- FIX DUPLICATE NOTIFICATION FUNCTIONS
-- =====================================================
-- Purpose: Remove duplicate create_notification functions
-- Issue: Multiple function signatures exist, causing "is not unique" error
-- Solution: Drop all versions and create ONE canonical version
-- =====================================================

-- =====================================================
-- STEP 1: Check how many versions exist
-- =====================================================

DO $$
DECLARE
  func_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname = 'create_notification';

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    FIXING DUPLICATE FUNCTIONS';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Found % versions of create_notification()', func_count;
  RAISE NOTICE '';
END $$;

-- =====================================================
-- STEP 2: Drop ALL versions of create_notification
-- =====================================================

-- Drop all possible signatures
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.create_notification(UUID, UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_notification(UUID, UUID, TEXT, TEXT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.create_notification(UUID, UUID, TEXT, TEXT, TEXT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, UUID, TEXT, TEXT, TEXT) CASCADE;

-- Nuclear option: Drop by name (gets all overloads)
DO $$
DECLARE
  func RECORD;
BEGIN
  FOR func IN
    SELECT p.oid::regprocedure as func_signature
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'create_notification'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func.func_signature || ' CASCADE';
    RAISE NOTICE '✓ Dropped: %', func.func_signature;
  END LOOP;
END $$;

-- =====================================================
-- STEP 3: Create ONE canonical version
-- =====================================================

CREATE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_actor_id UUID,
  p_title TEXT,
  p_message TEXT DEFAULT NULL,
  p_action_url TEXT DEFAULT NULL,
  p_post_id UUID DEFAULT NULL,
  p_comment_id UUID DEFAULT NULL,
  p_follow_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =====================================================
-- STEP 4: Verify only one version exists now
-- =====================================================

DO $$
DECLARE
  func_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname = 'create_notification';

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';

  IF func_count = 1 THEN
    RAISE NOTICE '✓ SUCCESS! Only 1 version of create_notification exists';
  ELSE
    RAISE NOTICE '⚠ WARNING: % versions still exist', func_count;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'Follow button should work now!';
  RAISE NOTICE '';
END $$;

SELECT '✓ Duplicate functions removed!' AS status;
SELECT '✓ Test the follow button now!' AS next_step;
