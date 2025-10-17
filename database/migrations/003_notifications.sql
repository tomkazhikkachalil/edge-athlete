-- =====================================================
-- COMPLETE NOTIFICATION SYSTEM SETUP
-- =====================================================
-- This script sets up the entire notification system with
-- correct table names and connections

-- =====================================================
-- PART 1: VERIFY EXISTING TABLES
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    VERIFYING EXISTING TABLES';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';

  -- Check profiles table
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles') THEN
    RAISE NOTICE '✓ profiles table exists';
  ELSE
    RAISE EXCEPTION '✗ profiles table NOT FOUND - required for notifications';
  END IF;

  -- Check posts table
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'posts') THEN
    RAISE NOTICE '✓ posts table exists';
  ELSE
    RAISE EXCEPTION '✗ posts table NOT FOUND - required for notifications';
  END IF;

  -- Check follows table
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'follows') THEN
    RAISE NOTICE '✓ follows table exists';
  ELSE
    RAISE EXCEPTION '✗ follows table NOT FOUND - required for follow notifications';
  END IF;

  -- Check post_likes table
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'post_likes') THEN
    RAISE NOTICE '✓ post_likes table exists';
  ELSE
    RAISE NOTICE '! post_likes table not found - will skip post like notifications';
  END IF;

  -- Check post_comments table
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'post_comments') THEN
    RAISE NOTICE '✓ post_comments table exists';
  ELSE
    RAISE NOTICE '! post_comments table not found - will skip comment notifications';
  END IF;

  RAISE NOTICE '';
END $$;

-- =====================================================
-- PART 2: CLEAN UP OLD NOTIFICATION SYSTEM
-- =====================================================

-- Drop all old triggers
DROP TRIGGER IF EXISTS trigger_notify_follow_request ON follows CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON follows CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_new_follower ON follows CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_post_like ON post_likes CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_post_comment ON post_comments CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_comment_like ON comment_likes CASCADE;
DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications CASCADE;
DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON notification_preferences CASCADE;

-- Drop all old functions
DROP FUNCTION IF EXISTS notify_follow_request() CASCADE;
DROP FUNCTION IF EXISTS notify_follow_accepted() CASCADE;
DROP FUNCTION IF EXISTS notify_new_follower() CASCADE;
DROP FUNCTION IF EXISTS notify_post_like() CASCADE;
DROP FUNCTION IF EXISTS notify_post_comment() CASCADE;
DROP FUNCTION IF EXISTS notify_comment_like() CASCADE;
DROP FUNCTION IF EXISTS create_notification(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_notifications() CASCADE;

-- Drop old tables
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS notification_preferences CASCADE;

-- =====================================================
-- PART 3: CREATE NOTIFICATIONS TABLE
-- =====================================================

CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'follow_request',
    'follow_accepted',
    'new_follower',
    'like',
    'comment',
    'comment_reply',
    'mention',
    'tag',
    'achievement',
    'system_announcement',
    'club_update',
    'team_update'
  )),
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  comment_id UUID,  -- No FK - flexible for future use
  follow_id UUID REFERENCES follows(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  action_url TEXT,
  metadata JSONB,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE notifications IS 'Central notifications table for all user notifications';
COMMENT ON COLUMN notifications.comment_id IS 'References post_comments.id - no FK for flexibility';

-- Create indexes
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_actor_id ON notifications(actor_id);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- PART 4: CREATE PREFERENCES TABLE
-- =====================================================

CREATE TABLE notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  follow_requests_enabled BOOLEAN DEFAULT true,
  follow_accepted_enabled BOOLEAN DEFAULT true,
  new_followers_enabled BOOLEAN DEFAULT true,
  likes_enabled BOOLEAN DEFAULT true,
  comments_enabled BOOLEAN DEFAULT true,
  mentions_enabled BOOLEAN DEFAULT true,
  tags_enabled BOOLEAN DEFAULT true,
  achievements_enabled BOOLEAN DEFAULT true,
  system_announcements_enabled BOOLEAN DEFAULT true,
  club_updates_enabled BOOLEAN DEFAULT true,
  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
  ON notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON notification_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
  ON notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- PART 5: CREATE UPDATE TRIGGERS
-- =====================================================

CREATE TRIGGER update_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- PART 6: CREATE HELPER FUNCTION
-- =====================================================

CREATE FUNCTION create_notification(
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

  -- Get or create preferences
  SELECT * INTO v_preferences
  FROM notification_preferences
  WHERE user_id = p_user_id;

  IF v_preferences IS NULL THEN
    INSERT INTO notification_preferences (user_id)
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
    INSERT INTO notifications (
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PART 7: FOLLOW NOTIFICATION TRIGGERS
-- =====================================================

CREATE FUNCTION notify_follow_request()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'pending' THEN
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name FROM profiles WHERE id = NEW.follower_id;

    PERFORM create_notification(
      p_user_id := NEW.following_id,
      p_type := 'follow_request',
      p_actor_id := NEW.follower_id,
      p_title := v_actor_name || ' sent you a follow request',
      p_message := NEW.message,
      p_action_url := '/app/followers?tab=requests',
      p_follow_id := NEW.id,
      p_metadata := jsonb_build_object('follow_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_follow_request
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_request();

CREATE FUNCTION notify_follow_accepted()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name FROM profiles WHERE id = NEW.following_id;

    PERFORM create_notification(
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_follow_accepted
  AFTER UPDATE ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_accepted();

CREATE FUNCTION notify_new_follower()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  IF NEW.status = 'accepted' THEN
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name FROM profiles WHERE id = NEW.follower_id;

    PERFORM create_notification(
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_new_follower
  AFTER INSERT ON follows
  FOR EACH ROW
  WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION notify_new_follower();

-- =====================================================
-- PART 8: POST LIKE NOTIFICATIONS (if table exists)
-- =====================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'post_likes') THEN
    -- Create function
    EXECUTE '
      CREATE FUNCTION notify_post_like()
      RETURNS TRIGGER AS $func$
      DECLARE
        v_actor_name TEXT;
        v_post_author UUID;
      BEGIN
        SELECT profile_id INTO v_post_author FROM posts WHERE id = NEW.post_id;
        IF v_post_author = NEW.profile_id THEN RETURN NEW; END IF;

        SELECT COALESCE(first_name || '' '' || last_name, full_name, ''Someone'')
        INTO v_actor_name FROM profiles WHERE id = NEW.profile_id;

        PERFORM create_notification(
          p_user_id := v_post_author,
          p_type := ''like'',
          p_actor_id := NEW.profile_id,
          p_title := v_actor_name || '' liked your post'',
          p_action_url := ''/feed?post='' || NEW.post_id,
          p_post_id := NEW.post_id,
          p_metadata := jsonb_build_object(''post_id'', NEW.post_id)
        );
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql SECURITY DEFINER;
    ';

    -- Create trigger
    EXECUTE '
      CREATE TRIGGER trigger_notify_post_like
        AFTER INSERT ON post_likes
        FOR EACH ROW
        EXECUTE FUNCTION notify_post_like();
    ';

    RAISE NOTICE '✓ Post like notifications enabled';
  ELSE
    RAISE NOTICE '! Skipped post like notifications (table not found)';
  END IF;
END $$;

-- =====================================================
-- PART 9: COMMENT NOTIFICATIONS (if table exists)
-- =====================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'post_comments') THEN
    -- Create function
    EXECUTE '
      CREATE FUNCTION notify_post_comment()
      RETURNS TRIGGER AS $func$
      DECLARE
        v_actor_name TEXT;
        v_post_author UUID;
        v_comment_preview TEXT;
      BEGIN
        SELECT profile_id INTO v_post_author FROM posts WHERE id = NEW.post_id;
        IF v_post_author = NEW.profile_id THEN RETURN NEW; END IF;

        SELECT COALESCE(first_name || '' '' || last_name, full_name, ''Someone'')
        INTO v_actor_name FROM profiles WHERE id = NEW.profile_id;

        v_comment_preview := SUBSTRING(NEW.content FROM 1 FOR 100);
        IF LENGTH(NEW.content) > 100 THEN
          v_comment_preview := v_comment_preview || ''...'';
        END IF;

        PERFORM create_notification(
          p_user_id := v_post_author,
          p_type := ''comment'',
          p_actor_id := NEW.profile_id,
          p_title := v_actor_name || '' commented on your post'',
          p_message := v_comment_preview,
          p_action_url := ''/feed?post='' || NEW.post_id || ''#comment-'' || NEW.id,
          p_post_id := NEW.post_id,
          p_comment_id := NEW.id,
          p_metadata := jsonb_build_object(''post_id'', NEW.post_id, ''comment_id'', NEW.id)
        );
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql SECURITY DEFINER;
    ';

    -- Create trigger
    EXECUTE '
      CREATE TRIGGER trigger_notify_post_comment
        AFTER INSERT ON post_comments
        FOR EACH ROW
        EXECUTE FUNCTION notify_post_comment();
    ';

    RAISE NOTICE '✓ Comment notifications enabled';
  ELSE
    RAISE NOTICE '! Skipped comment notifications (table not found)';
  END IF;
END $$;

-- =====================================================
-- PART 10: CLEANUP FUNCTION
-- =====================================================

CREATE FUNCTION cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM notifications
  WHERE is_read = true AND read_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PART 11: FINAL VERIFICATION
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
  RAISE NOTICE '║   NOTIFICATION SYSTEM SETUP COMPLETE! ✓        ║';
  RAISE NOTICE '╚════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'Database Tables:';
  RAISE NOTICE '  ✓ notifications';
  RAISE NOTICE '  ✓ notification_preferences';
  RAISE NOTICE '';
  RAISE NOTICE 'Active Triggers: %', v_trigger_count;
  RAISE NOTICE '  ✓ Follow Request';
  RAISE NOTICE '  ✓ Follow Accepted';
  RAISE NOTICE '  ✓ New Follower';
  RAISE NOTICE '  ✓ Post Like (if post_likes exists)';
  RAISE NOTICE '  ✓ Post Comment (if post_comments exists)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Run add-comment-likes.sql for comment like feature';
  RAISE NOTICE '  2. Enable Realtime in Supabase Dashboard';
  RAISE NOTICE '  3. Test notifications in your app!';
  RAISE NOTICE '';
END $$;
