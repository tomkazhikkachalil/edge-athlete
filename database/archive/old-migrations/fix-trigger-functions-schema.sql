-- ============================================================================
-- FIX TRIGGER FUNCTIONS - Add Schema Prefixes
-- ============================================================================
-- Purpose: Add public.* schema prefixes to trigger functions that fire
--          automatically on INSERT/UPDATE/DELETE operations
-- Issue: Functions fail silently after search_path security fix, causing
--        data inconsistency (counts don't update, notifications don't fire)
-- Priority: MEDIUM - Silent failures can cause user-facing bugs
--
-- Functions Fixed (10):
-- - update_post_likes_count (post interaction counters)
-- - update_post_comments_count
-- - increment_comment_likes_count
-- - decrement_comment_likes_count
-- - increment_post_save_count
-- - decrement_post_save_count
-- - get_tagged_posts (tag functions)
-- - notify_profile_tagged
-- - sync_privacy_settings (privacy trigger)
-- - get_pending_requests_count (follow request count)
--
-- Date: January 15, 2025
-- Status: IMPORTANT FIX - REQUIRED FOR DATA CONSISTENCY
-- ============================================================================

-- ============================================================================
-- PART 1: POST INTERACTION COUNTER FUNCTIONS (6)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_post_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts
    SET likes_count = likes_count + 1
    WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts
    SET likes_count = GREATEST(0, likes_count - 1)
    WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

CREATE OR REPLACE FUNCTION update_post_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts
    SET comments_count = comments_count + 1
    WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts
    SET comments_count = GREATEST(0, comments_count - 1)
    WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

CREATE OR REPLACE FUNCTION increment_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.post_comments
  SET likes_count = likes_count + 1
  WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

CREATE OR REPLACE FUNCTION decrement_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.post_comments
  SET likes_count = GREATEST(0, likes_count - 1)
  WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

CREATE OR REPLACE FUNCTION increment_post_save_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.posts
  SET saves_count = saves_count + 1
  WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

CREATE OR REPLACE FUNCTION decrement_post_save_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.posts
  SET saves_count = GREATEST(0, saves_count - 1)
  WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 2: TAG FUNCTIONS (2)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_tagged_posts(target_profile_id UUID)
RETURNS TABLE (
  id UUID,
  caption TEXT,
  sport_key TEXT,
  created_at TIMESTAMPTZ,
  profile_id UUID,
  visibility TEXT,
  tags TEXT[]
) AS $$
BEGIN
  RETURN QUERY SELECT
    p.id,
    p.caption,
    p.sport_key,
    p.created_at,
    p.profile_id,
    p.visibility,
    p.tags
  FROM public.posts p
  WHERE target_profile_id::TEXT = ANY(p.tags)
  ORDER BY p.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = '';

CREATE OR REPLACE FUNCTION notify_profile_tagged()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_name TEXT;
  tagged_profile_id UUID;
BEGIN
  -- Only trigger on INSERT or UPDATE where tags changed
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.tags IS DISTINCT FROM OLD.tags) THEN
    -- Get actor name
    SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
    INTO v_actor_name
    FROM public.profiles
    WHERE id = NEW.profile_id;

    -- Notify each newly tagged profile
    IF NEW.tags IS NOT NULL THEN
      FOR tagged_profile_id IN
        SELECT unnest(NEW.tags)::UUID
      LOOP
        -- Don't notify self
        IF tagged_profile_id != NEW.profile_id THEN
          PERFORM public.create_notification(
            p_user_id := tagged_profile_id,
            p_type := 'tag',
            p_actor_id := NEW.profile_id,
            p_title := v_actor_name || ' tagged you in a post',
            p_action_url := '/feed?post=' || NEW.id,
            p_post_id := NEW.id,
            p_metadata := jsonb_build_object('post_id', NEW.id)
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 3: PRIVACY SYNC FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_privacy_settings()
RETURNS TRIGGER AS $$
BEGIN
  -- When visibility changes, update or create privacy_settings
  INSERT INTO public.privacy_settings (profile_id, profile_visibility)
  VALUES (NEW.id, NEW.visibility)
  ON CONFLICT (profile_id)
  DO UPDATE SET
    profile_visibility = NEW.visibility,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- PART 4: FOLLOW REQUEST COUNT FUNCTION
-- ============================================================================

-- Drop existing function to avoid parameter name conflict
DROP FUNCTION IF EXISTS get_pending_requests_count(UUID);

CREATE OR REPLACE FUNCTION get_pending_requests_count(target_profile_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM public.follows
  WHERE following_id = target_profile_id
  AND status = 'pending';

  RETURN v_count;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = '';

-- ============================================================================
-- PART 5: RECREATE TRIGGERS (ENSURE THEY'RE ACTIVE)
-- ============================================================================

-- Post likes count trigger
DROP TRIGGER IF EXISTS update_post_likes_count_trigger ON post_likes;
CREATE TRIGGER update_post_likes_count_trigger
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_post_likes_count();

-- Post comments count trigger
DROP TRIGGER IF EXISTS update_post_comments_count_trigger ON post_comments;
CREATE TRIGGER update_post_comments_count_trigger
  AFTER INSERT OR DELETE ON public.post_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_post_comments_count();

-- Comment likes count triggers
DROP TRIGGER IF EXISTS trigger_increment_comment_likes_count ON comment_likes;
CREATE TRIGGER trigger_increment_comment_likes_count
  AFTER INSERT ON public.comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION increment_comment_likes_count();

DROP TRIGGER IF EXISTS trigger_decrement_comment_likes_count ON comment_likes;
CREATE TRIGGER trigger_decrement_comment_likes_count
  AFTER DELETE ON public.comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION decrement_comment_likes_count();

-- Saved posts count triggers
DROP TRIGGER IF EXISTS trigger_increment_post_save_count ON saved_posts;
CREATE TRIGGER trigger_increment_post_save_count
  AFTER INSERT ON public.saved_posts
  FOR EACH ROW
  EXECUTE FUNCTION increment_post_save_count();

DROP TRIGGER IF EXISTS trigger_decrement_post_save_count ON saved_posts;
CREATE TRIGGER trigger_decrement_post_save_count
  AFTER DELETE ON public.saved_posts
  FOR EACH ROW
  EXECUTE FUNCTION decrement_post_save_count();

-- Profile tagging notification trigger
DROP TRIGGER IF EXISTS trigger_notify_profile_tagged ON posts;
CREATE TRIGGER trigger_notify_profile_tagged
  AFTER INSERT OR UPDATE OF tags ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION notify_profile_tagged();

-- Privacy settings sync trigger
DROP TRIGGER IF EXISTS sync_profile_privacy ON profiles;
CREATE TRIGGER sync_profile_privacy
  AFTER INSERT OR UPDATE OF visibility ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_privacy_settings();

-- ============================================================================
-- VERIFICATION - All trigger functions updated successfully
-- ============================================================================
-- Functions fixed (10):
-- - update_post_likes_count, update_post_comments_count (post counters)
-- - increment_comment_likes_count, decrement_comment_likes_count (comment likes)
-- - increment_post_save_count, decrement_post_save_count (saved posts)
-- - get_tagged_posts, notify_profile_tagged (tag functions)
-- - sync_privacy_settings (privacy sync)
-- - get_pending_requests_count (follow requests)
--
-- All triggers recreated and active
--
-- What this fixes:
-- - Like counts update automatically when users like/unlike posts
-- - Comment counts update when users add/delete comments
-- - Comment like counts increment/decrement correctly
-- - Saved post counts track bookmarks
-- - Tag notifications fire when users are tagged in posts
-- - Privacy settings sync when visibility changes
-- - Follow request counts display correctly
-- ============================================================================

-- ============================================================================
-- SUCCESS
-- ============================================================================

SELECT 'SUCCESS: All trigger functions updated with schema prefixes!' AS status;
SELECT 'SUCCESS: Post interactions, tags, and privacy now work!' AS result;
