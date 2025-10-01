-- Fix Post Counts - Recalculate all likes_count and comments_count
-- Run this in Supabase SQL Editor

-- ============================================================================
-- STEP 1: Add columns if they don't exist
-- ============================================================================
ALTER TABLE posts ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comments_count INTEGER DEFAULT 0;

-- ============================================================================
-- STEP 2: Recalculate all likes counts
-- ============================================================================
UPDATE posts
SET likes_count = (
  SELECT COUNT(*)
  FROM post_likes
  WHERE post_likes.post_id = posts.id
);

-- ============================================================================
-- STEP 3: Recalculate all comments counts
-- ============================================================================
UPDATE posts
SET comments_count = (
  SELECT COUNT(*)
  FROM post_comments
  WHERE post_comments.post_id = posts.id
);

-- ============================================================================
-- STEP 4: Verify the update worked
-- ============================================================================
SELECT
  p.id,
  LEFT(p.caption, 40) as caption,
  p.likes_count as stored_likes,
  (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as actual_likes,
  p.comments_count as stored_comments,
  (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as actual_comments,
  CASE
    WHEN p.likes_count = (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) THEN '✓'
    ELSE '✗'
  END as likes_ok,
  CASE
    WHEN p.comments_count = (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) THEN '✓'
    ELSE '✗'
  END as comments_ok
FROM posts p
ORDER BY p.created_at DESC
LIMIT 20;

-- If all show ✓, the counts are now correct!

-- ============================================================================
-- STEP 5: Create the trigger functions if they don't exist
-- ============================================================================

-- Function for likes count
CREATE OR REPLACE FUNCTION update_post_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ language 'plpgsql';

-- Function for comments count
CREATE OR REPLACE FUNCTION update_post_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ language 'plpgsql';

-- ============================================================================
-- STEP 6: Create or replace the triggers
-- ============================================================================

-- Trigger for likes
DROP TRIGGER IF EXISTS update_likes_count ON post_likes;
CREATE TRIGGER update_likes_count
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_post_likes_count();

-- Trigger for comments
DROP TRIGGER IF EXISTS update_comments_count ON post_comments;
CREATE TRIGGER update_comments_count
  AFTER INSERT OR DELETE ON post_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_post_comments_count();

-- ============================================================================
-- STEP 7: Verify triggers are installed
-- ============================================================================
SELECT
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_name IN ('update_likes_count', 'update_comments_count')
ORDER BY event_object_table;

-- Should show 2 triggers

-- ============================================================================
-- DONE! Now test by:
-- 1. Like a post in your app
-- 2. Run this query to see if count increased:
-- SELECT id, caption, likes_count FROM posts ORDER BY updated_at DESC LIMIT 5;
-- ============================================================================
