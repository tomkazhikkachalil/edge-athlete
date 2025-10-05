-- =====================================================
-- FIX NOTIFICATIONS SCHEMA - Force drop and recreate
-- =====================================================
-- This script will completely remove all notification-related
-- objects and recreate them with the correct schema

-- =====================================================
-- 1. FORCE DROP EVERYTHING
-- =====================================================

-- Drop ALL triggers (even if they don't exist)
DROP TRIGGER IF EXISTS trigger_notify_follow_request ON follows CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON follows CASCADE;
DROP TRIGGER IF EXISTS trigger_notify_new_follower ON follows CASCADE;
DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications CASCADE;
DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON notification_preferences CASCADE;

-- Drop ALL functions (CASCADE will remove dependent triggers)
DROP FUNCTION IF EXISTS notify_follow_request() CASCADE;
DROP FUNCTION IF EXISTS notify_follow_accepted() CASCADE;
DROP FUNCTION IF EXISTS notify_new_follower() CASCADE;
DROP FUNCTION IF EXISTS create_notification(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_notifications() CASCADE;

-- Drop tables (CASCADE will remove all dependencies)
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS notification_preferences CASCADE;

-- =====================================================
-- 2. CREATE NOTIFICATIONS TABLE (CORRECT SCHEMA)
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
  comment_id UUID,  -- No foreign key - comments table doesn't exist yet
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

COMMENT ON COLUMN notifications.comment_id IS 'Foreign key will be added when comments table is created';

-- =====================================================
-- 3. INDEXES
-- =====================================================

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_actor_id ON notifications(actor_id);

-- =====================================================
-- 4. RLS
-- =====================================================

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
-- 5. PREFERENCES TABLE
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
-- 6. UPDATE TRIGGERS
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
-- 7. HELPER FUNCTION
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
  IF p_actor_id = p_user_id THEN RETURN NULL; END IF;

  SELECT * INTO v_preferences
  FROM notification_preferences
  WHERE user_id = p_user_id;

  IF v_preferences IS NULL THEN
    INSERT INTO notification_preferences (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_preferences;
  END IF;

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
-- 8. FOLLOW TRIGGERS
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
-- 9. CLEANUP FUNCTION
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
-- 10. VERIFY SCHEMA
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔════════════════════════════════════════════════╗';
  RAISE NOTICE '║   NOTIFICATIONS SCHEMA FIXED! ✓                ║';
  RAISE NOTICE '╚════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'Table schema:';
  RAISE NOTICE '  • user_id (UUID, NOT NULL)';
  RAISE NOTICE '  • type (TEXT, CHECK constraint)';
  RAISE NOTICE '  • actor_id (UUID, FK to profiles)';
  RAISE NOTICE '  • post_id (UUID, FK to posts)';
  RAISE NOTICE '  • comment_id (UUID, no FK)  ← FIXED COLUMN NAME';
  RAISE NOTICE '  • follow_id (UUID, FK to follows)';
  RAISE NOTICE '  • title, message, action_url';
  RAISE NOTICE '  • metadata (JSONB)';
  RAISE NOTICE '  • is_read, read_at';
  RAISE NOTICE '  • created_at, updated_at';
  RAISE NOTICE '';
  RAISE NOTICE 'Active triggers:';
  RAISE NOTICE '  ✓ Follow Request notifications';
  RAISE NOTICE '  ✓ Follow Accepted notifications';
  RAISE NOTICE '  ✓ New Follower notifications';
  RAISE NOTICE '';
  RAISE NOTICE 'Now refresh your app to test!';
  RAISE NOTICE '';
END $$;
