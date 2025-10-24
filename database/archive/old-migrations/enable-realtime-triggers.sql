-- ============================================================================
-- ENABLE REALTIME NOTIFICATION TRIGGERS (OPTIONAL)
-- ============================================================================
-- Run this AFTER enable-realtime-core.sql
-- This adds automatic notification creation for likes, comments, and follows
-- Only run this if you want auto-notifications enabled
-- ============================================================================

-- ============================================================================
-- STEP 1: Auto-create Notifications on Like
-- ============================================================================

CREATE OR REPLACE FUNCTION create_like_notification()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_id UUID;
  liker_name TEXT;
  v_table_name TEXT;
BEGIN
  -- Detect which table we're working with (likes or post_likes)
  v_table_name := TG_TABLE_NAME;

  -- Get the post owner's ID
  SELECT profile_id INTO post_owner_id
  FROM posts
  WHERE id = NEW.post_id;

  -- Don't notify if user liked their own post
  IF post_owner_id = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  -- Get liker's name
  SELECT COALESCE(
    CASE
      WHEN first_name IS NOT NULL AND last_name IS NOT NULL
      THEN first_name || ' ' || last_name
      ELSE full_name
    END,
    'Someone'
  )
  INTO liker_name
  FROM profiles
  WHERE id = NEW.profile_id;

  -- Create notification
  PERFORM notify_user(
    post_owner_id,
    NEW.profile_id,
    'like',
    NEW.post_id,
    liker_name || ' liked your post'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Try to create trigger on 'likes' table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'likes') THEN
    DROP TRIGGER IF EXISTS on_like_create_notification ON likes;
    CREATE TRIGGER on_like_create_notification
      AFTER INSERT ON likes
      FOR EACH ROW
      EXECUTE FUNCTION create_like_notification();
    RAISE NOTICE '✅ Like notification trigger created on "likes" table';
  END IF;
END $$;

-- Try to create trigger on 'post_likes' table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'post_likes') THEN
    DROP TRIGGER IF EXISTS on_like_create_notification ON post_likes;
    CREATE TRIGGER on_like_create_notification
      AFTER INSERT ON post_likes
      FOR EACH ROW
      EXECUTE FUNCTION create_like_notification();
    RAISE NOTICE '✅ Like notification trigger created on "post_likes" table';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Auto-create Notifications on Comment
-- ============================================================================

CREATE OR REPLACE FUNCTION create_comment_notification()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_id UUID;
  commenter_name TEXT;
BEGIN
  -- Get the post owner's ID
  SELECT profile_id INTO post_owner_id
  FROM posts
  WHERE id = NEW.post_id;

  -- Don't notify if user commented on their own post
  IF post_owner_id = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  -- Get commenter's name
  SELECT COALESCE(
    CASE
      WHEN first_name IS NOT NULL AND last_name IS NOT NULL
      THEN first_name || ' ' || last_name
      ELSE full_name
    END,
    'Someone'
  )
  INTO commenter_name
  FROM profiles
  WHERE id = NEW.profile_id;

  -- Create notification
  PERFORM notify_user(
    post_owner_id,
    NEW.profile_id,
    'comment',
    NEW.post_id,
    commenter_name || ' commented on your post'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Try to create trigger on 'comments' table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'comments') THEN
    DROP TRIGGER IF EXISTS on_comment_create_notification ON comments;
    CREATE TRIGGER on_comment_create_notification
      AFTER INSERT ON comments
      FOR EACH ROW
      EXECUTE FUNCTION create_comment_notification();
    RAISE NOTICE '✅ Comment notification trigger created on "comments" table';
  END IF;
END $$;

-- Try to create trigger on 'post_comments' table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'post_comments') THEN
    DROP TRIGGER IF EXISTS on_comment_create_notification ON post_comments;
    CREATE TRIGGER on_comment_create_notification
      AFTER INSERT ON post_comments
      FOR EACH ROW
      EXECUTE FUNCTION create_comment_notification();
    RAISE NOTICE '✅ Comment notification trigger created on "post_comments" table';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Auto-create Notifications on Follow
-- ============================================================================

CREATE OR REPLACE FUNCTION create_follow_notification()
RETURNS TRIGGER AS $$
DECLARE
  follower_name TEXT;
  notification_message TEXT;
BEGIN
  -- Only create notification when follow is accepted
  IF NEW.status != 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Don't notify on updates, only on initial accept
  IF TG_OP = 'UPDATE' AND OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Get follower's name
  SELECT COALESCE(
    CASE
      WHEN first_name IS NOT NULL AND last_name IS NOT NULL
      THEN first_name || ' ' || last_name
      ELSE full_name
    END,
    'Someone'
  )
  INTO follower_name
  FROM profiles
  WHERE id = NEW.follower_id;

  -- Create message
  notification_message := follower_name || ' started following you';

  -- Create notification
  PERFORM notify_user(
    NEW.following_id,  -- Notify the person being followed
    NEW.follower_id,   -- Actor is the follower
    'follow',
    NEW.id,
    notification_message
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on follows table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'follows') THEN
    DROP TRIGGER IF EXISTS on_follow_create_notification ON follows;
    CREATE TRIGGER on_follow_create_notification
      AFTER INSERT OR UPDATE ON follows
      FOR EACH ROW
      EXECUTE FUNCTION create_follow_notification();
    RAISE NOTICE '✅ Follow notification trigger created on "follows" table';
  ELSE
    RAISE NOTICE '⚠️  "follows" table not found - skipping follow notification trigger';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- List all notification triggers created
SELECT
  trigger_name,
  event_object_table as table_name,
  action_timing,
  event_manipulation as event
FROM information_schema.triggers
WHERE trigger_name LIKE '%notification%'
ORDER BY event_object_table, trigger_name;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Notification triggers enabled!';
  RAISE NOTICE '';
  RAISE NOTICE 'Auto-notifications will now be created for:';
  RAISE NOTICE '• Likes - When someone likes a post';
  RAISE NOTICE '• Comments - When someone comments on a post';
  RAISE NOTICE '• Follows - When someone follows a user';
  RAISE NOTICE '';
  RAISE NOTICE 'Test by:';
  RAISE NOTICE '1. Like a post (as different user)';
  RAISE NOTICE '2. Check notifications table for new entry';
  RAISE NOTICE '3. Real-time notification should appear in app';
END $$;
