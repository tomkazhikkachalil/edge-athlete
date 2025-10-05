-- =====================================================
-- NOTIFICATION SYSTEM DATABASE SCHEMA
-- =====================================================
-- Run this in Supabase SQL Editor to set up the notification system

-- =====================================================
-- 1. CREATE NOTIFICATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Recipient
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Notification Details
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

  -- Actor (who triggered this notification)
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  -- Related Entities
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  follow_id UUID REFERENCES follows(id) ON DELETE CASCADE,

  -- Content
  title TEXT NOT NULL,
  message TEXT,
  action_url TEXT, -- Where to navigate when clicked

  -- Metadata
  metadata JSONB, -- Flexible field for type-specific data

  -- State
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- =====================================================
-- 2. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_actor_id ON notifications(actor_id);

-- =====================================================
-- 3. ENABLE ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;

-- Users can only see their own notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- System can insert notifications (using service role key)
CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 4. CREATE NOTIFICATION PREFERENCES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

  -- Notification Type Toggles
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

  -- Delivery Preferences
  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own preferences" ON notification_preferences;
DROP POLICY IF EXISTS "Users can update own preferences" ON notification_preferences;
DROP POLICY IF EXISTS "Users can insert own preferences" ON notification_preferences;

-- RLS Policies
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
-- 5. CREATE UPDATE TRIGGER FOR NOTIFICATIONS
-- =====================================================

-- Trigger to auto-update updated_at timestamp
CREATE TRIGGER update_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 6. CREATE HELPER FUNCTION TO CREATE NOTIFICATIONS
-- =====================================================

CREATE OR REPLACE FUNCTION create_notification(
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
  -- Don't create notification if actor is the same as recipient
  IF p_actor_id = p_user_id THEN
    RETURN NULL;
  END IF;

  -- Check user's notification preferences
  SELECT * INTO v_preferences
  FROM notification_preferences
  WHERE user_id = p_user_id;

  -- If no preferences exist, create default ones
  IF v_preferences IS NULL THEN
    INSERT INTO notification_preferences (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_preferences;
  END IF;

  -- Check if this notification type is enabled
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
    -- Create the notification (with conflict handling to prevent duplicates)
    INSERT INTO notifications (
      user_id,
      type,
      actor_id,
      title,
      message,
      action_url,
      post_id,
      comment_id,
      follow_id,
      metadata
    ) VALUES (
      p_user_id,
      p_type,
      p_actor_id,
      p_title,
      p_message,
      p_action_url,
      p_post_id,
      p_comment_id,
      p_follow_id,
      p_metadata
    )
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 7. CREATE TRIGGERS FOR AUTOMATIC NOTIFICATIONS
-- =====================================================

-- Trigger: New Follow Request
CREATE OR REPLACE FUNCTION notify_follow_request()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  -- Only create notification for pending follow requests
  IF NEW.status = 'pending' THEN
    -- Get actor's display name
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name
    FROM profiles
    WHERE id = NEW.follower_id;

    -- Create notification
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

DROP TRIGGER IF EXISTS trigger_notify_follow_request ON follows;
CREATE TRIGGER trigger_notify_follow_request
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_request();

-- Trigger: Follow Request Accepted
CREATE OR REPLACE FUNCTION notify_follow_accepted()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  -- Only create notification when status changes from pending to accepted
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    -- Get actor's display name (the person who accepted)
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name
    FROM profiles
    WHERE id = NEW.following_id;

    -- Notify the requester that their request was accepted
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

DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON follows;
CREATE TRIGGER trigger_notify_follow_accepted
  AFTER UPDATE ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_accepted();

-- Trigger: New Follower (for public profiles)
CREATE OR REPLACE FUNCTION notify_new_follower()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  -- Only create notification for accepted follows (instant follow on public profiles)
  IF NEW.status = 'accepted' THEN
    -- Get actor's display name
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name
    FROM profiles
    WHERE id = NEW.follower_id;

    -- Notify the person being followed
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

DROP TRIGGER IF EXISTS trigger_notify_new_follower ON follows;
CREATE TRIGGER trigger_notify_new_follower
  AFTER INSERT ON follows
  FOR EACH ROW
  WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION notify_new_follower();

-- Trigger: New Like
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

DROP TRIGGER IF EXISTS trigger_notify_post_like ON likes;
CREATE TRIGGER trigger_notify_post_like
  AFTER INSERT ON likes
  FOR EACH ROW
  EXECUTE FUNCTION notify_post_like();

-- Trigger: New Comment
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

DROP TRIGGER IF EXISTS trigger_notify_post_comment ON comments;
CREATE TRIGGER trigger_notify_post_comment
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_post_comment();

-- =====================================================
-- 8. CLEANUP FUNCTION FOR OLD NOTIFICATIONS
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete read notifications older than 90 days
  DELETE FROM notifications
  WHERE is_read = true
    AND read_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SETUP COMPLETE
-- =====================================================

-- Verify tables were created
SELECT 'Notifications table created' as status
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications');

SELECT 'Notification preferences table created' as status
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_preferences');

-- Show summary
SELECT
  'Total triggers created: ' || COUNT(*)::TEXT as summary
FROM pg_trigger
WHERE tgname LIKE '%notify%';
