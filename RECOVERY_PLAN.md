# Recovery Plan - Restore Database Functionality

## What Happened

The `diagnose-and-fix-follows.sql` script included a `DROP TABLE IF EXISTS follows CASCADE;` command that deleted the follows table and potentially broke cascade relationships.

## Current Issues

1. ✅ Athlete profiles appear empty (data may be intact, just display issues)
2. ✅ Cannot update profile information
3. ✅ Followers functionality broken

## Recovery Steps

### Step 1: Check if Profile Data Still Exists

Run this in Supabase SQL Editor to verify profiles are intact:

```sql
-- Check if profiles table has data
SELECT COUNT(*) as total_profiles FROM profiles;

-- Check a sample profile
SELECT id, full_name, email, sport FROM profiles LIMIT 5;
```

If profiles exist, the data is safe and we just need to fix the UI.

### Step 2: Recreate Follows Table (Safe Version)

Run this SQL to recreate the follows table without affecting profiles:

```sql
-- Drop follows table if it exists
DROP TABLE IF EXISTS follows CASCADE;

-- Recreate follows table with proper relationships
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

-- Add indexes
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
CREATE INDEX idx_follows_status ON follows(status);

-- Add updated_at trigger
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

-- RLS Policies
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
```

### Step 3: Recreate Notifications Table

```sql
-- Drop notifications table if it exists
DROP TABLE IF EXISTS notifications CASCADE;

-- Create notifications table
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

-- Add indexes
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = recipient_id);

CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = recipient_id);

CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);
```

### Step 4: Create Notification Triggers

```sql
-- Trigger for follow requests
CREATE OR REPLACE FUNCTION notify_follow_request()
RETURNS TRIGGER AS $$
BEGIN
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

-- Trigger for follow accepted
CREATE OR REPLACE FUNCTION notify_follow_accepted()
RETURNS TRIGGER AS $$
BEGIN
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
```

### Step 5: Restart Development Server

```bash
# Stop the current dev server (Ctrl+C)
# Then restart
npm run dev
```

### Step 6: Clear Browser Cache

1. Open browser DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"
4. Or use Ctrl+Shift+R / Cmd+Shift+R

## If Profiles Are Actually Deleted

If Step 1 shows 0 profiles, we need to check if there's a backup. Supabase doesn't automatically backup development databases unless configured.

**Check for backup:**
1. Go to Supabase Dashboard → Database → Backups
2. Look for Point-in-Time Recovery options

**If no backup exists:**
You'll need to recreate test profiles manually or use the test user creation script.

## Next Steps

After completing these steps:
1. Test logging in
2. Test viewing your profile
3. Test editing profile information
4. Test followers functionality
5. Test notifications

Let me know which step you're on and if you encounter any errors.
