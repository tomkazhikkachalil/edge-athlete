-- FIX DOUBLE-TRIGGER ISSUE
-- This removes duplicate triggers and ensures only one trigger exists

-- =====================================================
-- 1. DROP ALL EXISTING TRIGGERS ON post_likes
-- =====================================================

DO $$
DECLARE
  trigger_record RECORD;
BEGIN
  FOR trigger_record IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'post_likes'::regclass
      AND tgname NOT LIKE 'pg_%'
  LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || trigger_record.tgname || ' ON post_likes';
    RAISE NOTICE 'Dropped trigger: %', trigger_record.tgname;
  END LOOP;
END $$;

-- =====================================================
-- 2. RECREATE THE TRIGGER FUNCTION (CLEAN VERSION)
-- =====================================================

CREATE OR REPLACE FUNCTION update_post_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Increment likes_count
    UPDATE posts
    SET likes_count = likes_count + 1
    WHERE id = NEW.post_id;

    RAISE NOTICE '[TRIGGER] Incremented likes_count for post %', NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    -- Decrement likes_count
    UPDATE posts
    SET likes_count = GREATEST(0, likes_count - 1)
    WHERE id = OLD.post_id;

    RAISE NOTICE '[TRIGGER] Decremented likes_count for post %', OLD.post_id;
  END IF;

  RETURN NULL; -- AFTER trigger, return value doesn't matter
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. CREATE SINGLE TRIGGER (ENSURE ONLY ONE)
-- =====================================================

-- Drop if exists (redundant but safe)
DROP TRIGGER IF EXISTS update_post_likes_count_trigger ON post_likes;

-- Create the trigger
CREATE TRIGGER update_post_likes_count_trigger
AFTER INSERT OR DELETE ON post_likes
FOR EACH ROW
EXECUTE FUNCTION update_post_likes_count();

-- =====================================================
-- 4. DO THE SAME FOR COMMENTS
-- =====================================================

-- Drop all comment triggers
DO $$
DECLARE
  trigger_record RECORD;
BEGIN
  FOR trigger_record IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'post_comments'::regclass
      AND tgname NOT LIKE 'pg_%'
  LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || trigger_record.tgname || ' ON post_comments';
    RAISE NOTICE 'Dropped trigger: %', trigger_record.tgname;
  END LOOP;
END $$;

-- Recreate comments trigger function
CREATE OR REPLACE FUNCTION update_post_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts
    SET comments_count = comments_count + 1
    WHERE id = NEW.post_id;

    RAISE NOTICE '[TRIGGER] Incremented comments_count for post %', NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts
    SET comments_count = GREATEST(0, comments_count - 1)
    WHERE id = OLD.post_id;

    RAISE NOTICE '[TRIGGER] Decremented comments_count for post %', OLD.post_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create single comments trigger
DROP TRIGGER IF EXISTS update_post_comments_count_trigger ON post_comments;

CREATE TRIGGER update_post_comments_count_trigger
AFTER INSERT OR DELETE ON post_comments
FOR EACH ROW
EXECUTE FUNCTION update_post_comments_count();

-- =====================================================
-- 5. RECALCULATE ALL COUNTS TO FIX EXISTING DATA
-- =====================================================

UPDATE posts
SET likes_count = (
  SELECT COUNT(*)
  FROM post_likes
  WHERE post_likes.post_id = posts.id
);

UPDATE posts
SET comments_count = (
  SELECT COUNT(*)
  FROM post_comments
  WHERE post_comments.post_id = posts.id
);

-- =====================================================
-- 6. VERIFICATION
-- =====================================================

SELECT 'VERIFICATION: Triggers on post_likes' as check_section;
SELECT
  tgname as trigger_name,
  tgenabled as enabled
FROM pg_trigger
WHERE tgrelid = 'post_likes'::regclass
  AND tgname NOT LIKE 'pg_%';

SELECT 'VERIFICATION: Triggers on post_comments' as check_section;
SELECT
  tgname as trigger_name,
  tgenabled as enabled
FROM pg_trigger
WHERE tgrelid = 'post_comments'::regclass
  AND tgname NOT LIKE 'pg_%';

SELECT 'VERIFICATION: Count accuracy' as check_section;
SELECT
  p.id as post_id,
  p.likes_count as stored_likes,
  COUNT(DISTINCT pl.id) as actual_likes,
  p.comments_count as stored_comments,
  COUNT(DISTINCT pc.id) as actual_comments
FROM posts p
LEFT JOIN post_likes pl ON pl.post_id = p.id
LEFT JOIN post_comments pc ON pc.post_id = p.id
GROUP BY p.id, p.likes_count, p.comments_count
ORDER BY p.created_at DESC
LIMIT 5;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ =====================================================';
  RAISE NOTICE '✅ TRIGGER FIX COMPLETE!';
  RAISE NOTICE '✅ =====================================================';
  RAISE NOTICE '✅ 1. Removed all duplicate triggers';
  RAISE NOTICE '✅ 2. Created single trigger for likes';
  RAISE NOTICE '✅ 3. Created single trigger for comments';
  RAISE NOTICE '✅ 4. Recalculated all counts';
  RAISE NOTICE '';
  RAISE NOTICE '🧪 Now test by liking/unliking a post';
  RAISE NOTICE '   Count should increment/decrement by exactly 1';
  RAISE NOTICE '';
END $$;
