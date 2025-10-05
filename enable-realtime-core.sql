-- ============================================================================
-- ENABLE REALTIME FEATURES - CORE ONLY
-- ============================================================================
-- This is a minimal version that only enables realtime without triggers
-- Run this first, then add notification triggers separately if needed
-- ============================================================================

-- ============================================================================
-- STEP 1: Create Notifications Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'follow', 'mention')),
  target_id UUID,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- STEP 2: Enable Row Level Security
-- ============================================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can insert notifications" ON notifications;

CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert notifications" ON notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================================
-- STEP 3: Create Indexes for Performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_notifications_profile_date
ON notifications(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_profile_read
ON notifications(profile_id, read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_actor
ON notifications(actor_id);

-- ============================================================================
-- STEP 4: Enable Replica Identity (Required for Realtime)
-- ============================================================================

ALTER TABLE posts REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- ============================================================================
-- STEP 5: Add Tables to Realtime Publication
-- ============================================================================

DO $$
BEGIN
  -- Enable realtime on posts table
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE posts;
  END IF;

  -- Enable realtime on notifications table
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

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications;
CREATE TRIGGER update_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 7: Create Helper Function to Send Notifications
-- ============================================================================

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
-- VERIFICATION QUERIES
-- ============================================================================

-- Check realtime status
SELECT
  tablename,
  CASE
    WHEN tablename IN (
      SELECT tablename
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
    ) THEN 'Enabled ✅'
    ELSE 'Disabled ❌'
  END as realtime_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('posts', 'notifications')
ORDER BY tablename;

-- Check replica identity
SELECT
  relname as table_name,
  CASE relreplident
    WHEN 'f' THEN 'Full ✅'
    WHEN 'd' THEN 'Default (primary key only) ⚠️'
    ELSE 'Not set ❌'
  END as replica_identity
FROM pg_class
WHERE relname IN ('posts', 'notifications')
ORDER BY relname;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Realtime features enabled successfully!';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Verify in Supabase Dashboard → Database → Replication';
  RAISE NOTICE '2. Check that posts and notifications tables show "Enabled"';
  RAISE NOTICE '3. Test real-time updates in your application';
  RAISE NOTICE '4. (Optional) Run enable-realtime-triggers.sql for auto-notifications';
END $$;
