# Quick Fix Guide - Followers/Notifications Setup

## Issue
The followers page shows "Failed to load data" because the database tables need to be set up.

## Solution

### Step 1: Access Supabase SQL Editor

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor** (left sidebar)
3. Click **New query**

### Step 2: Run These SQL Commands in Order

#### A. First, check if tables exist:
```sql
-- Check what tables you have
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

#### B. Check follows table structure:
```sql
-- Check follows table columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'follows'
AND table_schema = 'public';
```

#### C. Add missing columns to follows table:
```sql
-- Add status column if missing
ALTER TABLE follows
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'accepted'
CHECK (status IN ('pending', 'accepted', 'rejected'));

-- Add message column if missing
ALTER TABLE follows
ADD COLUMN IF NOT EXISTS message TEXT;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_follows_status ON follows(status);
```

#### D. Create notifications table:
```sql
-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('follow_request', 'follow_accepted', 'like', 'comment', 'mention', 'system')),

  related_post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  related_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  related_follow_id UUID REFERENCES follows(id) ON DELETE CASCADE,

  message TEXT,
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

  CONSTRAINT unique_notification_per_action
  UNIQUE NULLS NOT DISTINCT (recipient_id, actor_id, type, related_post_id, related_comment_id, related_follow_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(recipient_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for notifications
DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
CREATE POLICY "System can insert notifications" ON notifications
  FOR INSERT WITH CHECK (true);
```

#### E. Create connection_suggestions table:
```sql
-- Create connection suggestions table
CREATE TABLE IF NOT EXISTS connection_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  suggested_profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  score DECIMAL(3,2) DEFAULT 0.5,
  reason TEXT,
  dismissed BOOLEAN DEFAULT FALSE,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_suggestion UNIQUE (profile_id, suggested_profile_id)
);

-- Create indexes
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
```

#### F. Create notification triggers:
```sql
-- Function to create notification for follow requests
CREATE OR REPLACE FUNCTION notify_follow_request()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO notifications (recipient_id, actor_id, type, related_follow_id, message)
    VALUES (NEW.following_id, NEW.follower_id, 'follow_request', NEW.id, NEW.message)
    ON CONFLICT (recipient_id, actor_id, type, related_post_id, related_comment_id, related_follow_id)
    DO NOTHING;
  END IF;
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
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    INSERT INTO notifications (recipient_id, actor_id, type, related_follow_id)
    VALUES (NEW.follower_id, NEW.following_id, 'follow_accepted', NEW.id)
    ON CONFLICT (recipient_id, actor_id, type, related_post_id, related_comment_id, related_follow_id)
    DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for follow acceptance
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON follows;
CREATE TRIGGER trigger_notify_follow_accepted
  AFTER UPDATE ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_follow_accepted();

-- Function to create notification for likes
CREATE OR REPLACE FUNCTION notify_like()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_id UUID;
BEGIN
  SELECT profile_id INTO post_owner_id FROM posts WHERE id = NEW.post_id;

  IF post_owner_id IS NOT NULL AND post_owner_id != NEW.profile_id THEN
    INSERT INTO notifications (recipient_id, actor_id, type, related_post_id)
    VALUES (post_owner_id, NEW.profile_id, 'like', NEW.post_id)
    ON CONFLICT (recipient_id, actor_id, type, related_post_id, related_comment_id, related_follow_id)
    DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for likes
DROP TRIGGER IF EXISTS trigger_notify_like ON likes;
CREATE TRIGGER trigger_notify_like
  AFTER INSERT ON likes
  FOR EACH ROW
  EXECUTE FUNCTION notify_like();

-- Function to create notification for comments
CREATE OR REPLACE FUNCTION notify_comment()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_id UUID;
BEGIN
  SELECT profile_id INTO post_owner_id FROM posts WHERE id = NEW.post_id;

  IF post_owner_id IS NOT NULL AND post_owner_id != NEW.profile_id THEN
    INSERT INTO notifications (recipient_id, actor_id, type, related_post_id, related_comment_id)
    VALUES (post_owner_id, NEW.profile_id, 'comment', NEW.post_id, NEW.id)
    ON CONFLICT (recipient_id, actor_id, type, related_post_id, related_comment_id, related_follow_id)
    DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for comments
DROP TRIGGER IF EXISTS trigger_notify_comment ON comments;
CREATE TRIGGER trigger_notify_comment
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_comment();
```

#### G. Create helper functions:
```sql
-- Function to generate connection suggestions
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
    COALESCE(p.full_name, p.first_name || ' ' || p.last_name) as name,
    p.avatar_url,
    p.sport,
    p.school,
    (
      CASE WHEN p.sport = (SELECT sport FROM user_profile) THEN 0.4 ELSE 0.0 END +
      CASE WHEN p.school = (SELECT school FROM user_profile) THEN 0.3 ELSE 0.0 END +
      CASE WHEN p.team = (SELECT team FROM user_profile) THEN 0.2 ELSE 0.0 END +
      CASE WHEN p.position = (SELECT position FROM user_profile) THEN 0.1 ELSE 0.0 END
    )::DECIMAL(3,2) as score,
    (
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
    p.id != user_profile_id
    AND p.id NOT IN (SELECT following_id FROM already_following)
    AND p.id NOT IN (SELECT suggested_profile_id FROM already_suggested)
    AND p.visibility = 'public'
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
```

### Step 3: Verify Setup

Run this to check everything is working:

```sql
-- Check tables exist
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('notifications', 'connection_suggestions')
ORDER BY tablename;

-- Check follows table has new columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'follows'
AND column_name IN ('status', 'message');

-- Check triggers exist
SELECT tgname FROM pg_trigger
WHERE tgname LIKE 'trigger_notify%';

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('notifications', 'connection_suggestions');
```

### Step 4: Test the System

1. Refresh your application
2. Navigate to `/app/followers`
3. Should now load without errors

## Troubleshooting

### Error: "column 'status' does not exist"
Run step C again to add the status column.

### Error: "relation 'notifications' does not exist"
Run step D to create the notifications table.

### Error: "Failed to load data"
1. Check browser console for specific error
2. Check Supabase logs (Dashboard → Logs → API)
3. Verify RLS policies are correct

### Still having issues?
Check the full SQL file: `implement-notifications-system.sql`

Or run the entire file at once in Supabase SQL Editor.
