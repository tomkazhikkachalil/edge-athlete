-- COMPREHENSIVE DATABASE VERIFICATION AND FIX
-- Run this in Supabase SQL Editor step by step

-- ========================================
-- STEP 1: VERIFY PROFILES TABLE IS INTACT
-- ========================================
-- This should show your profiles - if it returns data, your profiles are safe
SELECT
  COUNT(*) as total_profiles,
  COUNT(CASE WHEN full_name IS NOT NULL THEN 1 END) as profiles_with_names
FROM profiles;

-- Show sample profiles (verify your data is here)
SELECT
  id,
  full_name,
  email,
  sport,
  created_at
FROM profiles
ORDER BY created_at DESC
LIMIT 5;

-- ========================================
-- STEP 2: CHECK CURRENT FOLLOWS TABLE STATE
-- ========================================
-- Check if follows table exists and its structure
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'follows'
ORDER BY ordinal_position;

-- Check foreign key constraints
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'follows'
  AND tc.constraint_type = 'FOREIGN KEY';

-- ========================================
-- STEP 3: RECREATE FOLLOWS TABLE
-- ========================================
-- This will delete existing follows but NOT profiles
DROP TABLE IF EXISTS follows CASCADE;

CREATE TABLE follows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'rejected')),
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(follower_id, following_id)
);

-- Create indexes
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
CREATE INDEX idx_follows_status ON follows(status);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_follows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_follows_updated_at
  BEFORE UPDATE ON follows
  FOR EACH ROW
  EXECUTE FUNCTION update_follows_updated_at();

-- Enable RLS
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own follows" ON follows;
DROP POLICY IF EXISTS "Users can create follows" ON follows;
DROP POLICY IF EXISTS "Users can update their own follows" ON follows;
DROP POLICY IF EXISTS "Users can delete their own follows" ON follows;

-- Create RLS policies
CREATE POLICY "Users can view their own follows"
  ON follows FOR SELECT
  USING (auth.uid() = follower_id OR auth.uid() = following_id);

CREATE POLICY "Users can create follows"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can update their own follows"
  ON follows FOR UPDATE
  USING (auth.uid() = follower_id OR auth.uid() = following_id);

CREATE POLICY "Users can delete their own follows"
  ON follows FOR DELETE
  USING (auth.uid() = follower_id);

-- ========================================
-- STEP 4: RECREATE NOTIFICATIONS TABLE
-- ========================================
DROP TABLE IF EXISTS notifications CASCADE;

CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('follow_request', 'follow_accepted', 'like', 'comment', 'mention', 'system')),
  related_post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  related_follow_id UUID REFERENCES follows(id) ON DELETE CASCADE,
  message TEXT,
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create indexes
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON notifications;

-- Create RLS policies
CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = recipient_id);

CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = recipient_id);

CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- ========================================
-- STEP 5: CREATE NOTIFICATION TRIGGERS
-- ========================================

-- Trigger for new follow requests
DROP TRIGGER IF EXISTS trigger_notify_follow_request ON follows;
DROP FUNCTION IF EXISTS notify_follow_request();

CREATE OR REPLACE FUNCTION notify_follow_request()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create notification for pending requests (private profiles)
  IF NEW.status = 'pending' THEN
    INSERT INTO notifications (recipient_id, actor_id, type, related_follow_id, message)
    VALUES (NEW.following_id, NEW.follower_id, 'follow_request', NEW.id, NEW.message);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_follow_request
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_request();

-- Trigger for accepted follow requests
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON follows;
DROP FUNCTION IF EXISTS notify_follow_accepted();

CREATE OR REPLACE FUNCTION notify_follow_accepted()
RETURNS TRIGGER AS $$
BEGIN
  -- Notify when a pending request is accepted
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    INSERT INTO notifications (recipient_id, actor_id, type, related_follow_id)
    VALUES (NEW.follower_id, NEW.following_id, 'follow_accepted', NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_follow_accepted
  AFTER UPDATE ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_accepted();

-- ========================================
-- STEP 6: VERIFY SETUP
-- ========================================

-- Verify follows table structure
SELECT
  'FOLLOWS TABLE' as table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'follows'
ORDER BY ordinal_position;

-- Verify foreign keys are present
SELECT
  'FOREIGN KEYS' as check_type,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS references_table
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'follows'
  AND tc.constraint_type = 'FOREIGN KEY';

-- Verify RLS is enabled
SELECT
  'RLS STATUS' as check_type,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('follows', 'notifications');

-- Verify triggers exist
SELECT
  'TRIGGERS' as check_type,
  trigger_name,
  event_manipulation,
  event_object_table
FROM information_schema.triggers
WHERE event_object_table IN ('follows', 'notifications')
ORDER BY event_object_table, trigger_name;

-- Final verification
SELECT
  'SETUP COMPLETE' as status,
  'Follows table: ' || COUNT(*) as follows_count
FROM follows;

SELECT
  'PROFILES INTACT' as status,
  'Total profiles: ' || COUNT(*) as profile_count
FROM profiles;
