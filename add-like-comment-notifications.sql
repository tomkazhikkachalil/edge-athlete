-- =====================================================
-- ADD LIKE AND COMMENT NOTIFICATION TRIGGERS
-- =====================================================
-- This adds notifications for likes and comments

-- =====================================================
-- 1. LIKE NOTIFICATION TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION notify_post_like()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_post_author UUID;
BEGIN
  -- Get post author
  SELECT profile_id INTO v_post_author
  FROM posts
  WHERE id = NEW.post_id;

  -- Don't notify if user likes their own post
  IF v_post_author = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  -- Get actor's display name
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name
  FROM profiles
  WHERE id = NEW.profile_id;

  -- Create notification
  PERFORM create_notification(
    p_user_id := v_post_author,
    p_type := 'like',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' liked your post',
    p_action_url := '/feed?post=' || NEW.post_id,
    p_post_id := NEW.post_id,
    p_metadata := jsonb_build_object('post_id', NEW.post_id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_notify_post_like ON post_likes;
CREATE TRIGGER trigger_notify_post_like
  AFTER INSERT ON post_likes
  FOR EACH ROW
  EXECUTE FUNCTION notify_post_like();

-- =====================================================
-- 2. COMMENT NOTIFICATION TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION notify_post_comment()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_post_author UUID;
  v_comment_preview TEXT;
BEGIN
  -- Get post author
  SELECT profile_id INTO v_post_author
  FROM posts
  WHERE id = NEW.post_id;

  -- Don't notify if user comments on their own post
  IF v_post_author = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  -- Get actor's display name
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name
  FROM profiles
  WHERE id = NEW.profile_id;

  -- Create comment preview (first 100 characters)
  v_comment_preview := SUBSTRING(NEW.content FROM 1 FOR 100);
  IF LENGTH(NEW.content) > 100 THEN
    v_comment_preview := v_comment_preview || '...';
  END IF;

  -- Create notification
  PERFORM create_notification(
    p_user_id := v_post_author,
    p_type := 'comment',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' commented on your post',
    p_message := v_comment_preview,
    p_action_url := '/feed?post=' || NEW.post_id || '#comment-' || NEW.id,
    p_post_id := NEW.post_id,
    p_comment_id := NEW.id,
    p_metadata := jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_notify_post_comment ON post_comments;
CREATE TRIGGER trigger_notify_post_comment
  AFTER INSERT ON post_comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_post_comment();

-- =====================================================
-- 3. VERIFY SETUP
-- =====================================================

DO $$
DECLARE
  v_trigger_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE tgname LIKE '%notify%';

  RAISE NOTICE '';
  RAISE NOTICE '╔════════════════════════════════════════════════╗';
  RAISE NOTICE '║   LIKE & COMMENT NOTIFICATIONS ENABLED! ✓      ║';
  RAISE NOTICE '╚════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'Total notification triggers: %', v_trigger_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Active Notifications:';
  RAISE NOTICE '  ✓ Follow Request';
  RAISE NOTICE '  ✓ Follow Accepted';
  RAISE NOTICE '  ✓ New Follower';
  RAISE NOTICE '  ✓ Post Like           ← NEW!';
  RAISE NOTICE '  ✓ Post Comment        ← NEW!';
  RAISE NOTICE '';
  RAISE NOTICE 'Test by:';
  RAISE NOTICE '  1. Like someone else''s post';
  RAISE NOTICE '  2. Comment on someone else''s post';
  RAISE NOTICE '  3. Check the notification bell icon';
  RAISE NOTICE '';
END $$;
