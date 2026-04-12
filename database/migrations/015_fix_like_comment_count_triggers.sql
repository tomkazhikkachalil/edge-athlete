-- =====================================================
-- FIX: Like and comment count consistency
-- =====================================================
-- Problem: posts.likes_count and posts.comments_count cached columns
-- can drift from the actual row counts in post_likes / post_comments.
-- The API layer now recounts after each operation, but these triggers
-- serve as defense-in-depth for any direct inserts/deletes.
-- =====================================================

-- =====================================================
-- 1. Trigger: keep posts.likes_count in sync
-- =====================================================
CREATE OR REPLACE FUNCTION update_post_likes_count()
RETURNS TRIGGER AS $$
DECLARE
  target_post_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post_id := OLD.post_id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE public.posts
  SET likes_count = (
    SELECT COUNT(*) FROM public.post_likes WHERE post_id = target_post_id
  )
  WHERE id = target_post_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

DROP TRIGGER IF EXISTS trigger_update_post_likes_count ON post_likes;
CREATE TRIGGER trigger_update_post_likes_count
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_post_likes_count();

-- =====================================================
-- 2. Trigger: keep posts.comments_count in sync
-- =====================================================
CREATE OR REPLACE FUNCTION update_post_comments_count()
RETURNS TRIGGER AS $$
DECLARE
  target_post_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_post_id := OLD.post_id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE public.posts
  SET comments_count = (
    SELECT COUNT(*) FROM public.post_comments WHERE post_id = target_post_id
  )
  WHERE id = target_post_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

DROP TRIGGER IF EXISTS trigger_update_post_comments_count ON post_comments;
CREATE TRIGGER trigger_update_post_comments_count
  AFTER INSERT OR DELETE ON post_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_post_comments_count();

-- =====================================================
-- 3. One-time recount to fix all existing stale data
-- =====================================================
UPDATE posts
SET likes_count = (
  SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = posts.id
);

UPDATE posts
SET comments_count = (
  SELECT COUNT(*) FROM post_comments WHERE post_comments.post_id = posts.id
);
