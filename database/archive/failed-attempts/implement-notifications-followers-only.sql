-- NOTIFICATIONS & FOLLOWERS SYSTEM - FOLLOWERS ONLY
-- This version ONLY sets up followers and follow request notifications
-- No dependencies on likes or comments tables

-- =====================================================
-- PHASE 1: NOTIFICATIONS TABLE (BASIC)
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE, -- Can be null for system notifications
  type TEXT NOT NULL CHECK (type IN ('follow_request', 'follow_accepted', 'like', 'comment', 'mention', 'system')),

  -- Reference to related entity
  related_post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  related_follow_id UUID REFERENCES follows(id) ON DELETE CASCADE,

  -- Notification content
  message TEXT, -- For system notifications or custom messages

  -- Status
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(recipient_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
CREATE POLICY "System can insert notifications" ON notifications
  FOR INSERT WITH CHECK (true); -- Triggers/functions will create these


-- =====================================================
-- PHASE 2: UPDATE FOLLOWS TABLE
-- =====================================================

-- Add message column to follows table (optional message with follow request)
ALTER TABLE follows
ADD COLUMN IF NOT EXISTS message TEXT;

-- Add status column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'follows' AND column_name = 'status'
  ) THEN
    ALTER TABLE follows
    ADD COLUMN status TEXT DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'rejected'));

    -- Update existing rows to have 'accepted' status
    UPDATE follows SET status = 'accepted' WHERE status IS NULL;
  END IF;
END $$;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_follows_status ON follows(status);
CREATE INDEX IF NOT EXISTS idx_follows_message ON follows(message) WHERE message IS NOT NULL;


-- =====================================================
-- PHASE 3: CONNECTION SUGGESTIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS connection_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  suggested_profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Suggestion scoring and reasoning
  score DECIMAL(3,2) DEFAULT 0.5, -- 0.0 to 1.0
  reason TEXT, -- e.g., "Same school", "Same sport", "Mutual connections"

  -- Status tracking
  dismissed BOOLEAN DEFAULT FALSE,
  dismissed_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- Unique constraint: one suggestion per pair
  CONSTRAINT unique_suggestion UNIQUE (profile_id, suggested_profile_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_suggestions_profile ON connection_suggestions(profile_id, score DESC) WHERE NOT dismissed;
CREATE INDEX IF NOT EXISTS idx_suggestions_created ON connection_suggestions(created_at DESC);

-- Enable RLS
ALTER TABLE connection_suggestions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their own suggestions" ON connection_suggestions;
CREATE POLICY "Users can view their own suggestions" ON connection_suggestions
  FOR SELECT USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "Users can dismiss their own suggestions" ON connection_suggestions;
CREATE POLICY "Users can dismiss their own suggestions" ON connection_suggestions
  FOR UPDATE USING (auth.uid() = profile_id);


-- =====================================================
-- PHASE 4: NOTIFICATION TRIGGERS (FOLLOW ONLY)
-- =====================================================

-- Function to create notification for follow requests
CREATE OR REPLACE FUNCTION notify_follow_request()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create notification for pending requests (not accepted follows)
  IF NEW.status = 'pending' THEN
    INSERT INTO notifications (recipient_id, actor_id, type, related_follow_id, message)
    VALUES (
      NEW.following_id,
      NEW.follower_id,
      'follow_request',
      NEW.id,
      NEW.message -- Include the follow request message if provided
    );
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the follow insert
    RAISE WARNING 'Failed to create follow request notification: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for follow requests
DROP TRIGGER IF EXISTS trigger_notify_follow_request ON follows;
CREATE TRIGGER trigger_notify_follow_request
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_request();


-- Function to create notification when follow is accepted
CREATE OR REPLACE FUNCTION notify_follow_accepted()
RETURNS TRIGGER AS $$
BEGIN
  -- When status changes from pending to accepted
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    INSERT INTO notifications (recipient_id, actor_id, type, related_follow_id)
    VALUES (
      NEW.follower_id, -- Notify the person who requested
      NEW.following_id, -- From the person who accepted
      'follow_accepted',
      NEW.id
    );
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the follow update
    RAISE WARNING 'Failed to create follow accepted notification: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for follow acceptance
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON follows;
CREATE TRIGGER trigger_notify_follow_accepted
  AFTER UPDATE ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_accepted();


-- =====================================================
-- PHASE 5: CONNECTION SUGGESTION GENERATION FUNCTION
-- =====================================================

-- Function to generate connection suggestions based on profile similarity
CREATE OR REPLACE FUNCTION generate_connection_suggestions(
  user_profile_id UUID,
  suggestion_limit INT DEFAULT 10
)
RETURNS TABLE (
  suggested_id UUID,
  suggested_name TEXT,
  suggested_avatar TEXT,
  suggested_sport TEXT,
  suggested_school TEXT,
  similarity_score DECIMAL,
  reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH user_profile AS (
    SELECT sport, school, team, location, position
    FROM profiles
    WHERE id = user_profile_id
  ),
  already_following AS (
    SELECT following_id FROM follows WHERE follower_id = user_profile_id
  ),
  already_suggested AS (
    SELECT suggested_profile_id FROM connection_suggestions
    WHERE profile_id = user_profile_id AND NOT dismissed
  )
  SELECT
    p.id,
    COALESCE(p.full_name, p.first_name || ' ' || p.last_name, 'User') as name,
    p.avatar_url,
    p.sport,
    p.school,
    (
      -- Score calculation
      CASE WHEN p.sport = (SELECT sport FROM user_profile) THEN 0.4 ELSE 0.0 END +
      CASE WHEN p.school = (SELECT school FROM user_profile) THEN 0.3 ELSE 0.0 END +
      CASE WHEN p.team = (SELECT team FROM user_profile) THEN 0.2 ELSE 0.0 END +
      CASE WHEN p.position = (SELECT position FROM user_profile) THEN 0.1 ELSE 0.0 END
    )::DECIMAL(3,2) as score,
    (
      -- Reason text
      CASE
        WHEN p.sport = (SELECT sport FROM user_profile) AND p.school = (SELECT school FROM user_profile)
          THEN 'Same sport and school'
        WHEN p.sport = (SELECT sport FROM user_profile) AND p.team = (SELECT team FROM user_profile)
          THEN 'Same sport and team'
        WHEN p.sport = (SELECT sport FROM user_profile)
          THEN 'Same sport'
        WHEN p.school = (SELECT school FROM user_profile)
          THEN 'Same school'
        WHEN p.team = (SELECT team FROM user_profile)
          THEN 'Same team'
        ELSE 'Suggested for you'
      END
    ) as reason
  FROM profiles p
  WHERE
    p.id != user_profile_id -- Not yourself
    AND p.id NOT IN (SELECT following_id FROM already_following) -- Not already following
    AND p.id NOT IN (SELECT suggested_profile_id FROM already_suggested) -- Not already suggested
    AND (p.visibility = 'public' OR p.visibility IS NULL) -- Only public profiles (or null for backward compat)
    AND (
      p.sport = (SELECT sport FROM user_profile) OR
      p.school = (SELECT school FROM user_profile) OR
      p.team = (SELECT team FROM user_profile) OR
      p.location = (SELECT location FROM user_profile)
    )
  ORDER BY score DESC, p.created_at DESC
  LIMIT suggestion_limit;
END;
$$ LANGUAGE plpgsql;


-- =====================================================
-- PHASE 6: HELPER FUNCTIONS
-- =====================================================

-- Function to get unread notification count
CREATE OR REPLACE FUNCTION get_unread_notification_count(user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  count INTEGER;
BEGIN
  SELECT COUNT(*) INTO count
  FROM notifications
  WHERE recipient_id = user_id AND read = FALSE;

  RETURN COALESCE(count, 0);
END;
$$ LANGUAGE plpgsql;


-- Function to mark all notifications as read
CREATE OR REPLACE FUNCTION mark_all_notifications_read(user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE notifications
  SET read = TRUE, read_at = NOW()
  WHERE recipient_id = user_id AND read = FALSE;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;


-- Function to get pending follow requests count
CREATE OR REPLACE FUNCTION get_pending_requests_count(user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  count INTEGER;
BEGIN
  SELECT COUNT(*) INTO count
  FROM follows
  WHERE following_id = user_id AND status = 'pending';

  RETURN COALESCE(count, 0);
END;
$$ LANGUAGE plpgsql;


-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Verify tables created
SELECT '✅ Tables created successfully!' as status;
SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'connection_suggestions')
  ORDER BY tablename;

-- Verify follows table columns
SELECT '✅ Follows table updated:' as status;
SELECT column_name FROM information_schema.columns
WHERE table_name = 'follows'
AND column_name IN ('status', 'message')
ORDER BY column_name;

-- Verify RLS enabled
SELECT '✅ RLS enabled:' as status;
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'connection_suggestions');

-- Verify triggers
SELECT '✅ Triggers created:' as status;
SELECT tgname FROM pg_trigger
  WHERE tgname LIKE 'trigger_notify%'
  ORDER BY tgname;

-- Verify functions
SELECT '✅ Functions created:' as status;
SELECT proname FROM pg_proc WHERE proname IN (
  'notify_follow_request',
  'notify_follow_accepted',
  'generate_connection_suggestions',
  'get_unread_notification_count',
  'mark_all_notifications_read',
  'get_pending_requests_count'
)
ORDER BY proname;

SELECT '🎉 Setup complete! You can now use the followers and notifications system.' as final_status;
SELECT 'Navigate to /app/followers in your app to test!' as next_step;
