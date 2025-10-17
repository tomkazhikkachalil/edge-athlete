-- FIX LIKES AND COMMENTS ISSUES
-- Run this AFTER running diagnose-likes-comments.sql to see what needs fixing

-- =====================================================
-- 1. ENSURE UNIQUE CONSTRAINT ON POST_LIKES
-- =====================================================

-- First, remove any duplicate likes (keep the oldest one based on created_at)
DELETE FROM post_likes
WHERE id IN (
  SELECT pl.id
  FROM post_likes pl
  INNER JOIN (
    SELECT post_id, profile_id, MIN(created_at) as first_like
    FROM post_likes
    GROUP BY post_id, profile_id
    HAVING COUNT(*) > 1
  ) dupes ON pl.post_id = dupes.post_id
         AND pl.profile_id = dupes.profile_id
  WHERE pl.created_at > dupes.first_like
);

-- Ensure unique constraint exists
DO $$
BEGIN
  -- Drop existing constraint if present (in case it's malformed)
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'post_likes_post_id_profile_id_key'
  ) THEN
    ALTER TABLE post_likes DROP CONSTRAINT post_likes_post_id_profile_id_key;
  END IF;

  -- Add the unique constraint
  ALTER TABLE post_likes
  ADD CONSTRAINT post_likes_post_id_profile_id_key UNIQUE (post_id, profile_id);

  RAISE NOTICE '✅ Unique constraint added to post_likes';
EXCEPTION
  WHEN duplicate_table THEN
    RAISE NOTICE 'ℹ️ Unique constraint already exists';
  WHEN others THEN
    RAISE NOTICE '❌ Error adding unique constraint: %', SQLERRM;
END $$;

-- =====================================================
-- 2. RECALCULATE LIKES COUNT FOR ALL POSTS
-- =====================================================

UPDATE posts
SET likes_count = (
  SELECT COUNT(*)
  FROM post_likes
  WHERE post_likes.post_id = posts.id
);

SELECT '✅ Recalculated likes_count for all posts' as status;

-- =====================================================
-- 3. RECALCULATE COMMENTS COUNT FOR ALL POSTS
-- =====================================================

UPDATE posts
SET comments_count = (
  SELECT COUNT(*)
  FROM post_comments
  WHERE post_comments.post_id = posts.id
);

SELECT '✅ Recalculated comments_count for all posts' as status;

-- =====================================================
-- 4. VERIFY TRIGGERS EXIST FOR AUTO-UPDATING COUNTS
-- =====================================================

-- Check if likes trigger exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_post_likes_count_trigger'
    AND tgrelid = 'post_likes'::regclass
  ) THEN
    -- Create the trigger function if missing
    CREATE OR REPLACE FUNCTION update_post_likes_count()
    RETURNS TRIGGER AS $func$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE posts
        SET likes_count = likes_count + 1
        WHERE id = NEW.post_id;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE posts
        SET likes_count = GREATEST(0, likes_count - 1)
        WHERE id = OLD.post_id;
      END IF;
      RETURN NULL;
    END;
    $func$ LANGUAGE plpgsql;

    -- Create the trigger
    CREATE TRIGGER update_post_likes_count_trigger
    AFTER INSERT OR DELETE ON post_likes
    FOR EACH ROW EXECUTE FUNCTION update_post_likes_count();

    RAISE NOTICE '✅ Created likes count trigger';
  ELSE
    RAISE NOTICE 'ℹ️ Likes count trigger already exists';
  END IF;
END $$;

-- Check if comments trigger exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_post_comments_count_trigger'
    AND tgrelid = 'post_comments'::regclass
  ) THEN
    -- Create the trigger function if missing
    CREATE OR REPLACE FUNCTION update_post_comments_count()
    RETURNS TRIGGER AS $func$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE posts
        SET comments_count = comments_count + 1
        WHERE id = NEW.post_id;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE posts
        SET comments_count = GREATEST(0, comments_count - 1)
        WHERE id = OLD.post_id;
      END IF;
      RETURN NULL;
    END;
    $func$ LANGUAGE plpgsql;

    -- Create the trigger
    CREATE TRIGGER update_post_comments_count_trigger
    AFTER INSERT OR DELETE ON post_comments
    FOR EACH ROW EXECUTE FUNCTION update_post_comments_count();

    RAISE NOTICE '✅ Created comments count trigger';
  ELSE
    RAISE NOTICE 'ℹ️ Comments count trigger already exists';
  END IF;
END $$;

-- =====================================================
-- 5. VERIFY INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_profile_id ON post_likes(profile_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_profile_id ON post_comments(profile_id);

SELECT '✅ Ensured indexes exist for performance' as status;

-- =====================================================
-- 6. VERIFICATION REPORT
-- =====================================================

SELECT '📊 VERIFICATION REPORT' as report_section;

-- Check for any remaining count mismatches in likes
SELECT
  'Likes Count Mismatches' as check_type,
  COUNT(*) as mismatched_posts
FROM (
  SELECT posts.id
  FROM posts
  LEFT JOIN post_likes ON post_likes.post_id = posts.id
  GROUP BY posts.id, posts.likes_count
  HAVING posts.likes_count != COUNT(post_likes.id)
) subq;

-- Check for any remaining count mismatches in comments
SELECT
  'Comments Count Mismatches' as check_type,
  COUNT(*) as mismatched_posts
FROM (
  SELECT posts.id
  FROM posts
  LEFT JOIN post_comments ON post_comments.post_id = posts.id
  GROUP BY posts.id, posts.comments_count
  HAVING posts.comments_count != COUNT(post_comments.id)
) subq;

-- Show total counts
SELECT
  'Total Posts' as metric,
  COUNT(*) as count
FROM posts
UNION ALL
SELECT
  'Total Likes' as metric,
  COUNT(*) as count
FROM post_likes
UNION ALL
SELECT
  'Total Comments' as metric,
  COUNT(*) as count
FROM post_comments;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ =====================================================';
  RAISE NOTICE '✅ LIKES AND COMMENTS FIX COMPLETE!';
  RAISE NOTICE '✅ =====================================================';
  RAISE NOTICE '✅ 1. Removed duplicate likes (if any)';
  RAISE NOTICE '✅ 2. Added unique constraint to prevent future duplicates';
  RAISE NOTICE '✅ 3. Recalculated all likes_count values';
  RAISE NOTICE '✅ 4. Recalculated all comments_count values';
  RAISE NOTICE '✅ 5. Verified triggers are in place';
  RAISE NOTICE '✅ 6. Verified indexes for performance';
  RAISE NOTICE '';
  RAISE NOTICE '🧪 Test by:';
  RAISE NOTICE '   1. Liking a post (should only allow one like per user)';
  RAISE NOTICE '   2. Commenting on a post (should save and display)';
  RAISE NOTICE '   3. Checking counts match actual data';
  RAISE NOTICE '';
END $$;
