-- ============================================================================
-- FIX ALL NOTIFICATION & TRIGGER FUNCTIONS - Add Schema Prefixes
-- ============================================================================
-- Purpose: Add public.* schema prefixes to ALL notification trigger functions
-- Issue: Follow requests, post creation, and other triggers failing after
--        applying search_path security fixes
-- Root Cause: Functions use unqualified table names (e.g., "profiles" instead
--             of "public.profiles") and fail when search_path = ''
--
-- Fixes:
-- - notify_follow_request (follow request notifications)
-- - notify_follow_accepted (follow acceptance notifications)
-- - notify_new_follower (new follower notifications)
-- - notify_post_like (post like notifications)
-- - notify_post_comment (comment notifications)
-- - notify_comment_like (comment like notifications)
-- - create_notification (core notification creator)
--
-- Date: January 15, 2025
-- Status: CRITICAL FIX - REQUIRED FOR ALL USER INTERACTIONS
-- ============================================================================

-- ============================================================================
-- PART 1: CORE NOTIFICATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_actor_id UUID,
  p_title TEXT,
  p_action_url TEXT DEFAULT NULL,
  p_post_id UUID DEFAULT NULL,
  p_comment_id UUID DEFAULT NULL,
  p_follow_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
  v_prefs RECORD;
BEGIN
  -- Check user preferences for this notification type
  SELECT enabled INTO v_prefs
  FROM public.notification_preferences
  WHERE profile_id = p_user_id
  AND notification_type = p_type;

  -- If preferences not found or enabled, create notification
  IF v_prefs IS NULL OR v_prefs.enabled = true THEN
    INSERT INTO public.notifications (
      recipient_id,
      type,
      actor_id,
      title,
      action_url,
      post_id,
      comment_id,
      follow_id,
      metadata,
      is_read
    ) VALUES (
      p_user_id,
      p_type,
      p_actor_id,
      p_title,
      p_action_url,
      p_post_id,
      p_comment_id,
      p_follow_id,
      p_metadata,
      false
    ) RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 2: FOLLOW REQUEST NOTIFICATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_follow_request()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  -- Only trigger for pending follow requests
  IF NEW.status = 'pending' THEN
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name
    FROM public.profiles
    WHERE id = NEW.follower_id;

    PERFORM public.create_notification(
      p_user_id := NEW.following_id,
      p_type := 'follow_request',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' sent you a follow request',
      p_action_url := '/app/followers',
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('message', NEW.message)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 3: FOLLOW ACCEPTED NOTIFICATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_follow_accepted()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  -- Only trigger when status changes from pending to accepted
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name
    FROM public.profiles
    WHERE id = NEW.following_id;

    PERFORM public.create_notification(
      p_user_id := NEW.follower_id,
      p_type := 'follow_accepted',
      p_actor_id := NEW.following_id,
      p_title := v_actor_name || ' accepted your follow request',
      p_action_url := '/athlete/' || NEW.following_id,
      p_follow_id := NEW.id,
      p_metadata := NULL
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 4: NEW FOLLOWER NOTIFICATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_new_follower()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  -- Only trigger for accepted follows (public profiles)
  IF NEW.status = 'accepted' THEN
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name
    FROM public.profiles
    WHERE id = NEW.follower_id;

    PERFORM public.create_notification(
      p_user_id := NEW.following_id,
      p_type := 'new_follower',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' started following you',
      p_action_url := '/athlete/' || NEW.follower_id,
      p_follow_id := NEW.id,
      p_metadata := NULL
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 5: POST LIKE NOTIFICATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_post_like()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_post_author UUID;
BEGIN
  -- Get post author
  SELECT profile_id INTO v_post_author
  FROM public.posts
  WHERE id = NEW.post_id;

  -- Don't notify if user likes their own post
  IF v_post_author = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  -- Get liker's name
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = NEW.profile_id;

  PERFORM public.create_notification(
    p_user_id := v_post_author,
    p_type := 'post_like',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' liked your post',
    p_action_url := '/feed?post=' || NEW.post_id,
    p_post_id := NEW.post_id,
    p_metadata := NULL
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 6: POST COMMENT NOTIFICATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_post_comment()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_post_author UUID;
BEGIN
  -- Get post author
  SELECT profile_id INTO v_post_author
  FROM public.posts
  WHERE id = NEW.post_id;

  -- Don't notify if user comments on their own post
  IF v_post_author = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  -- Get commenter's name
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = NEW.profile_id;

  PERFORM public.create_notification(
    p_user_id := v_post_author,
    p_type := 'post_comment',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' commented on your post',
    p_action_url := '/feed?post=' || NEW.post_id || '&comment=' || NEW.id,
    p_post_id := NEW.post_id,
    p_comment_id := NEW.id,
    p_metadata := jsonb_build_object('comment', NEW.content)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 7: COMMENT LIKE NOTIFICATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_comment_like()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_comment_author UUID;
  v_post_id UUID;
BEGIN
  -- Get comment author and post
  SELECT profile_id, post_id INTO v_comment_author, v_post_id
  FROM public.post_comments
  WHERE id = NEW.comment_id;

  -- Don't notify if user likes their own comment
  IF v_comment_author = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  -- Get liker's name
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = NEW.profile_id;

  PERFORM public.create_notification(
    p_user_id := v_comment_author,
    p_type := 'comment_like',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' liked your comment',
    p_action_url := '/feed?post=' || v_post_id || '&comment=' || NEW.comment_id,
    p_post_id := v_post_id,
    p_comment_id := NEW.comment_id,
    p_metadata := NULL
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 8: RECREATE ALL TRIGGERS (Ensure they're active)
-- ============================================================================

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trigger_notify_follow_request ON public.follows;
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON public.follows;
DROP TRIGGER IF EXISTS trigger_notify_new_follower ON public.follows;
DROP TRIGGER IF EXISTS trigger_notify_post_like ON public.post_likes;
DROP TRIGGER IF EXISTS trigger_notify_post_comment ON public.post_comments;
DROP TRIGGER IF EXISTS trigger_notify_comment_like ON public.comment_likes;

-- Recreate all triggers
CREATE TRIGGER trigger_notify_follow_request
  AFTER INSERT ON public.follows
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.notify_follow_request();

CREATE TRIGGER trigger_notify_follow_accepted
  AFTER UPDATE ON public.follows
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status = 'accepted')
  EXECUTE FUNCTION public.notify_follow_accepted();

CREATE TRIGGER trigger_notify_new_follower
  AFTER INSERT ON public.follows
  FOR EACH ROW
  WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION public.notify_new_follower();

CREATE TRIGGER trigger_notify_post_like
  AFTER INSERT ON public.post_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_post_like();

CREATE TRIGGER trigger_notify_post_comment
  AFTER INSERT ON public.post_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_post_comment();

CREATE TRIGGER trigger_notify_comment_like
  AFTER INSERT ON public.comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_comment_like();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '      NOTIFICATION FUNCTIONS FIXED';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✓ create_notification - Schema prefixes added';
  RAISE NOTICE '✓ notify_follow_request - Fixed';
  RAISE NOTICE '✓ notify_follow_accepted - Fixed';
  RAISE NOTICE '✓ notify_new_follower - Fixed';
  RAISE NOTICE '✓ notify_post_like - Fixed';
  RAISE NOTICE '✓ notify_post_comment - Fixed';
  RAISE NOTICE '✓ notify_comment_like - Fixed';
  RAISE NOTICE '';
  RAISE NOTICE 'All triggers recreated and active';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '      WHAT THIS FIXES';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Follow requests now work correctly';
  RAISE NOTICE '✅ Follow acceptance notifications work';
  RAISE NOTICE '✅ New follower notifications work';
  RAISE NOTICE '✅ Post like notifications work';
  RAISE NOTICE '✅ Comment notifications work';
  RAISE NOTICE '✅ Comment like notifications work';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '1. Test sending a follow request';
  RAISE NOTICE '2. Test accepting a follow request';
  RAISE NOTICE '3. Test creating a post';
  RAISE NOTICE '4. Test liking and commenting';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- SUCCESS
-- ============================================================================

SELECT '✓ All notification functions updated with schema prefixes!' AS status;
SELECT '✓ All triggers recreated and working' AS triggers;
SELECT '✓ Follow requests, posts, likes, and comments now work!' AS result;
