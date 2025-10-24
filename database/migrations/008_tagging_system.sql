-- =====================================================
-- COMPREHENSIVE TAGGING SYSTEM
-- =====================================================
-- Allows users to tag people (users/organizations) in posts, photos, videos, and rounds
-- Includes notifications, privacy controls, and profile integration
-- Run this in Supabase SQL Editor

-- =====================================================
-- 1. CREATE POST TAGS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS post_tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- What's being tagged
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  media_id UUID REFERENCES post_media(id) ON DELETE CASCADE, -- Optional: specific media item

  -- Who's tagged
  tagged_profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Who created the tag
  created_by_profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Tag position (for photo/video tags)
  position_x DECIMAL(5,2), -- Percentage position (0-100)
  position_y DECIMAL(5,2), -- Percentage position (0-100)

  -- Tag status and approval
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'removed', 'declined')),

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- Prevent duplicate tags
  CONSTRAINT unique_post_tag UNIQUE (post_id, tagged_profile_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_post_tags_post_id ON post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tagged_profile ON post_tags(tagged_profile_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_created_by ON post_tags(created_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_status ON post_tags(status);
CREATE INDEX IF NOT EXISTS idx_post_tags_media_id ON post_tags(media_id) WHERE media_id IS NOT NULL;

-- Add comments
COMMENT ON TABLE post_tags IS 'Tags linking posts to profiles (users/organizations)';
COMMENT ON COLUMN post_tags.media_id IS 'Optional: specific media item within the post';
COMMENT ON COLUMN post_tags.position_x IS 'Horizontal position percentage (0-100) for photo/video tags';
COMMENT ON COLUMN post_tags.position_y IS 'Vertical position percentage (0-100) for photo/video tags';
COMMENT ON COLUMN post_tags.status IS 'Tag status: active, pending (awaiting approval), removed (by tagged user), declined';

-- =====================================================
-- 2. ROW LEVEL SECURITY POLICIES
-- =====================================================

ALTER TABLE post_tags ENABLE ROW LEVEL SECURITY;

-- Anyone can view active tags on public posts
DROP POLICY IF EXISTS "Anyone can view active tags on public posts" ON post_tags;
CREATE POLICY "Anyone can view active tags on public posts" ON post_tags
  FOR SELECT USING (
    status = 'active' AND
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_tags.post_id
      AND posts.visibility = 'public'
    )
  );

-- Users can view tags they created or tags they're in
DROP POLICY IF EXISTS "Users can view their own tags" ON post_tags;
CREATE POLICY "Users can view their own tags" ON post_tags
  FOR SELECT USING (
    auth.uid() = created_by_profile_id OR
    auth.uid() = tagged_profile_id
  );

-- Users can create tags on posts they own
DROP POLICY IF EXISTS "Users can create tags on their posts" ON post_tags;
CREATE POLICY "Users can create tags on their posts" ON post_tags
  FOR INSERT WITH CHECK (
    auth.uid() = created_by_profile_id AND
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_tags.post_id
      AND posts.profile_id = auth.uid()
    )
  );

-- Users can update tags they created
DROP POLICY IF EXISTS "Users can update their own tags" ON post_tags;
CREATE POLICY "Users can update their own tags" ON post_tags
  FOR UPDATE USING (auth.uid() = created_by_profile_id);

-- Users can delete tags they created
DROP POLICY IF EXISTS "Users can delete their own tags" ON post_tags;
CREATE POLICY "Users can delete their own tags" ON post_tags
  FOR DELETE USING (auth.uid() = created_by_profile_id);

-- Tagged users can update their tag status (remove/decline)
DROP POLICY IF EXISTS "Tagged users can update their tag status" ON post_tags;
CREATE POLICY "Tagged users can update their tag status" ON post_tags
  FOR UPDATE USING (auth.uid() = tagged_profile_id);

-- =====================================================
-- 3. NOTIFICATION TRIGGERS FOR TAGS
-- =====================================================

-- Function to notify when someone is tagged
CREATE OR REPLACE FUNCTION notify_profile_tagged()
RETURNS TRIGGER AS $$
BEGIN
  -- Don't notify if tagging yourself
  IF NEW.tagged_profile_id = NEW.created_by_profile_id THEN
    RETURN NEW;
  END IF;

  -- Check if tagged user wants tag notifications (check preferences)
  IF EXISTS (
    SELECT 1 FROM notification_preferences
    WHERE profile_id = NEW.tagged_profile_id
    AND tag_notifications_enabled = true
  ) OR NOT EXISTS (
    SELECT 1 FROM notification_preferences
    WHERE profile_id = NEW.tagged_profile_id
  ) THEN
    -- Create notification
    INSERT INTO notifications (
      profile_id,
      type,
      actor_profile_id,
      post_id,
      metadata,
      created_at
    ) VALUES (
      NEW.tagged_profile_id,
      'tag',
      NEW.created_by_profile_id,
      NEW.post_id,
      jsonb_build_object(
        'tag_id', NEW.id,
        'media_id', NEW.media_id
      ),
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for tag notifications
DROP TRIGGER IF EXISTS trigger_notify_profile_tagged ON post_tags;
CREATE TRIGGER trigger_notify_profile_tagged
  AFTER INSERT ON post_tags
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION notify_profile_tagged();

-- =====================================================
-- 4. ADD TAG NOTIFICATION PREFERENCE
-- =====================================================

-- Add tag notification preference to notification_preferences table
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS tag_notifications_enabled BOOLEAN DEFAULT true;

COMMENT ON COLUMN notification_preferences.tag_notifications_enabled IS 'Receive notifications when tagged in posts';

-- =====================================================
-- 5. AUTOMATIC TIMESTAMP UPDATE
-- =====================================================

CREATE OR REPLACE FUNCTION update_post_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_post_tags_timestamp ON post_tags;
CREATE TRIGGER trigger_update_post_tags_timestamp
  BEFORE UPDATE ON post_tags
  FOR EACH ROW
  EXECUTE FUNCTION update_post_tags_updated_at();

-- =====================================================
-- 6. UPDATE NOTIFICATIONS TABLE TO SUPPORT TAGS
-- =====================================================

-- Ensure the notifications table supports the 'tag' type
-- (This should already exist from your notification system, but adding for completeness)

DO $$
BEGIN
  -- Check if 'tag' type constraint exists, if not, recreate it
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_type_check'
  ) THEN
    -- Drop and recreate the constraint to include 'tag'
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN (
        'follow_request',
        'follow_accepted',
        'new_follower',
        'post_like',
        'post_comment',
        'comment_like',
        'tag'
      ));
  END IF;
END $$;

-- =====================================================
-- 7. HELPER FUNCTIONS
-- =====================================================

-- Function to get tagged posts for a profile
CREATE OR REPLACE FUNCTION get_tagged_posts(
  target_profile_id UUID,
  current_user_id UUID DEFAULT NULL,
  page_limit INTEGER DEFAULT 20,
  page_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  post_id UUID,
  tag_id UUID,
  tag_created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pt.post_id,
    pt.id as tag_id,
    pt.created_at as tag_created_at
  FROM post_tags pt
  INNER JOIN posts p ON p.id = pt.post_id
  WHERE pt.tagged_profile_id = target_profile_id
    AND pt.status = 'active'
    AND (
      -- Show if post is public
      p.visibility = 'public'
      -- Or if current user is the tagged person
      OR current_user_id = target_profile_id
      -- Or if current user is the post owner
      OR current_user_id = p.profile_id
    )
  ORDER BY pt.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 8. VERIFICATION QUERIES
-- =====================================================

-- Verify table was created
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'post_tags'
ORDER BY ordinal_position;

-- Verify indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'post_tags'
ORDER BY indexname;

-- Verify RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'post_tags';

-- Verify policies
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'post_tags'
ORDER BY policyname;
