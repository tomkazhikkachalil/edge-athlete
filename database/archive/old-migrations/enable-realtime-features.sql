-- ============================================================================
-- ENABLE REALTIME FEATURES
-- ============================================================================
-- Run this SQL in Supabase SQL Editor to enable all real-time features
-- This enables WebSocket subscriptions for posts and notifications
-- ============================================================================

-- ============================================================================
-- STEP 1: Create Notifications Table (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'follow', 'mention')),
  target_id UUID,  -- ID of the post, comment, etc. that triggered the notification
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- STEP 2: Enable Row Level Security
-- ============================================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can insert notifications" ON notifications;

-- Policy: Users can view their own notifications
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT USING (auth.uid() = profile_id);

-- Policy: Users can update their own notifications (mark as read)
CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = profile_id);

-- Policy: Any authenticated user can create notifications
-- (This allows other users to send you notifications)
CREATE POLICY "Users can insert notifications" ON notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================================
-- STEP 3: Create Indexes for Performance
-- ============================================================================

-- Index for fetching user's notifications sorted by date
CREATE INDEX IF NOT EXISTS idx_notifications_profile_date
ON notifications(profile_id, created_at DESC);

-- Index for filtering unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_profile_read
ON notifications(profile_id, read, created_at DESC);

-- Index for actor lookups
CREATE INDEX IF NOT EXISTS idx_notifications_actor
ON notifications(actor_id);

-- ============================================================================
-- STEP 4: Enable Replica Identity (Required for Realtime)
-- ============================================================================

-- This allows Supabase Realtime to track changes to rows
ALTER TABLE posts REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- ============================================================================
-- STEP 5: Add Tables to Realtime Publication
-- ============================================================================

-- Enable realtime on posts table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE posts;
  END IF;
END $$;

-- Enable realtime on notifications table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;

-- ============================================================================
-- STEP 6: Create Trigger for Updated_at Timestamp
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for notifications table
DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications;
CREATE TRIGGER update_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 7: Create Function to Send Notifications
-- ============================================================================

-- Helper function to create notifications
-- Usage: SELECT notify_user('user-id', 'actor-id', 'like', 'post-id', 'John liked your post');
CREATE OR REPLACE FUNCTION notify_user(
  p_profile_id UUID,
  p_actor_id UUID,
  p_type TEXT,
  p_target_id UUID,
  p_message TEXT
)
RETURNS UUID AS $$
DECLARE
  notification_id UUID;
BEGIN
  INSERT INTO notifications (profile_id, actor_id, type, target_id, message)
  VALUES (p_profile_id, p_actor_id, p_type, p_target_id, p_message)
  RETURNING id INTO notification_id;

  RETURN notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 8: Auto-create Notifications on Like (Optional)
-- ============================================================================

-- Trigger function to create notification when post is liked
CREATE OR REPLACE FUNCTION create_like_notification()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_id UUID;
  liker_name TEXT;
BEGIN
  -- Get the post owner's ID
  SELECT profile_id INTO post_owner_id
  FROM posts
  WHERE id = NEW.post_id;

  -- Don't notify if user liked their own post
  IF post_owner_id = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  -- Get liker's name
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
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

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_like_create_notification ON likes;

-- Create trigger on likes table
CREATE TRIGGER on_like_create_notification
  AFTER INSERT ON likes
  FOR EACH ROW
  EXECUTE FUNCTION create_like_notification();

-- ============================================================================
-- STEP 9: Auto-create Notifications on Comment (Optional)
-- ============================================================================

-- Trigger function to create notification when post is commented on
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
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
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

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_comment_create_notification ON comments;

-- Create trigger on comments table
CREATE TRIGGER on_comment_create_notification
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION create_comment_notification();

-- ============================================================================
-- STEP 10: Auto-create Notifications on Follow (Optional)
-- ============================================================================

-- Trigger function to create notification when followed
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
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO follower_name
  FROM profiles
  WHERE id = NEW.follower_id;

  -- Create appropriate message
  IF NEW.status = 'accepted' THEN
    notification_message := follower_name || ' started following you';
  ELSE
    notification_message := follower_name || ' wants to follow you';
  END IF;

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

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_follow_create_notification ON follows;

-- Create trigger on follows table
CREATE TRIGGER on_follow_create_notification
  AFTER INSERT OR UPDATE ON follows
  FOR EACH ROW
  EXECUTE FUNCTION create_follow_notification();

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check if realtime is enabled for tables
SELECT
  schemaname,
  tablename,
  CASE
    WHEN tablename IN (
      SELECT tablename
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
    ) THEN 'Enabled'
    ELSE 'Disabled'
  END as realtime_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('posts', 'notifications')
ORDER BY tablename;

-- Check replica identity
SELECT
  schemaname,
  tablename,
  CASE relreplident
    WHEN 'd' THEN 'Default (primary key)'
    WHEN 'f' THEN 'Full (all columns)'
    WHEN 'i' THEN 'Index'
    WHEN 'n' THEN 'Nothing'
  END as replica_identity
FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('posts', 'notifications');

-- Check indexes on notifications
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'notifications'
ORDER BY indexname;

-- ============================================================================
-- TEST DATA (Optional - for testing notifications)
-- ============================================================================

-- Create a test notification (replace UUIDs with actual user IDs)
-- SELECT notify_user(
--   'user-to-notify-id'::UUID,
--   'actor-user-id'::UUID,
--   'like',
--   'post-id'::UUID,
--   'Test notification message'
-- );

-- ============================================================================
-- DONE
-- ============================================================================

-- Real-time features are now enabled!
--
-- Next steps:
-- 1. Verify in Supabase Dashboard → Database → Replication
-- 2. Check that posts and notifications tables appear in the list
-- 3. Test real-time updates in the application
-- 4. Monitor WebSocket connections in Dashboard → Realtime
