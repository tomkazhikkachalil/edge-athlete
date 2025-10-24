-- =====================================================
-- ADD COMMENT LIKES FEATURE
-- =====================================================
-- This adds the ability to like comments and get notifications

-- =====================================================
-- 1. CREATE COMMENT_LIKES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS comment_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- Prevent duplicate likes (one user can only like a comment once)
  UNIQUE(comment_id, profile_id)
);

-- =====================================================
-- 2. CREATE INDEXES
-- =====================================================

CREATE INDEX idx_comment_likes_comment_id ON comment_likes(comment_id);
CREATE INDEX idx_comment_likes_profile_id ON comment_likes(profile_id);
CREATE INDEX idx_comment_likes_created_at ON comment_likes(created_at DESC);

-- =====================================================
-- 3. ENABLE RLS
-- =====================================================

ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

-- Anyone can view comment likes
CREATE POLICY "Comment likes are viewable by everyone"
  ON comment_likes FOR SELECT
  USING (true);

-- Users can insert their own likes
CREATE POLICY "Users can like comments"
  ON comment_likes FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

-- Users can delete their own likes
CREATE POLICY "Users can unlike comments"
  ON comment_likes FOR DELETE
  USING (auth.uid() = profile_id);

-- =====================================================
-- 4. ADD LIKES_COUNT TO POST_COMMENTS
-- =====================================================

-- Add likes_count column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'post_comments' AND column_name = 'likes_count'
  ) THEN
    ALTER TABLE post_comments ADD COLUMN likes_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- =====================================================
-- 5. CREATE TRIGGER TO UPDATE COMMENT LIKES COUNT
-- =====================================================

-- Function to increment comment likes count
CREATE OR REPLACE FUNCTION increment_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE post_comments
  SET likes_count = likes_count + 1
  WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to decrement comment likes count
CREATE OR REPLACE FUNCTION decrement_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE post_comments
  SET likes_count = GREATEST(0, likes_count - 1)
  WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Triggers
DROP TRIGGER IF EXISTS trigger_increment_comment_likes_count ON comment_likes;
CREATE TRIGGER trigger_increment_comment_likes_count
  AFTER INSERT ON comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION increment_comment_likes_count();

DROP TRIGGER IF EXISTS trigger_decrement_comment_likes_count ON comment_likes;
CREATE TRIGGER trigger_decrement_comment_likes_count
  AFTER DELETE ON comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION decrement_comment_likes_count();

-- =====================================================
-- 6. CREATE NOTIFICATION TRIGGER FOR COMMENT LIKES
-- =====================================================

CREATE OR REPLACE FUNCTION notify_comment_like()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  v_comment_author UUID;
  v_post_id UUID;
  v_comment_preview TEXT;
BEGIN
  -- Get comment author and post_id
  SELECT profile_id, post_id, content
  INTO v_comment_author, v_post_id, v_comment_preview
  FROM post_comments
  WHERE id = NEW.comment_id;

  -- Don't notify if user likes their own comment
  IF v_comment_author = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  -- Get actor's display name
  SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
  INTO v_actor_name
  FROM profiles
  WHERE id = NEW.profile_id;

  -- Create comment preview (first 50 characters)
  v_comment_preview := SUBSTRING(v_comment_preview FROM 1 FOR 50);
  IF LENGTH(v_comment_preview) > 50 THEN
    v_comment_preview := v_comment_preview || '...';
  END IF;

  -- Create notification
  PERFORM create_notification(
    p_user_id := v_comment_author,
    p_type := 'like',
    p_actor_id := NEW.profile_id,
    p_title := v_actor_name || ' liked your comment',
    p_message := v_comment_preview,
    p_action_url := '/feed?post=' || v_post_id || '#comment-' || NEW.comment_id,
    p_post_id := v_post_id,
    p_comment_id := NEW.comment_id,
    p_metadata := jsonb_build_object('comment_id', NEW.comment_id, 'post_id', v_post_id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_notify_comment_like ON comment_likes;
CREATE TRIGGER trigger_notify_comment_like
  AFTER INSERT ON comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION notify_comment_like();

-- =====================================================
-- 7. VERIFY SETUP
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔════════════════════════════════════════════════╗';
  RAISE NOTICE '║     COMMENT LIKES FEATURE ENABLED! ✓           ║';
  RAISE NOTICE '╚════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'Created:';
  RAISE NOTICE '  ✓ comment_likes table';
  RAISE NOTICE '  ✓ likes_count column on post_comments';
  RAISE NOTICE '  ✓ RLS policies for comment likes';
  RAISE NOTICE '  ✓ Automatic likes count update triggers';
  RAISE NOTICE '  ✓ Notification trigger for comment likes';
  RAISE NOTICE '';
  RAISE NOTICE 'Now you can:';
  RAISE NOTICE '  • Like comments';
  RAISE NOTICE '  • Get notified when someone likes your comment';
  RAISE NOTICE '  • See likes count on each comment';
  RAISE NOTICE '';
  RAISE NOTICE 'Next step: Create API endpoint at /api/comments/like';
  RAISE NOTICE '';
END $$;
