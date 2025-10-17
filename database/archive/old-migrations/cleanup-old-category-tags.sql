-- =====================================================
-- CLEANUP OLD CATEGORY TAGS FROM POSTS
-- =====================================================
-- This script removes old category tags (lifestyle, casual, etc.)
-- from the posts.tags column, which should now only contain user UUIDs.
--
-- Run this AFTER deploying the tagging fix to clean up old data.
-- Run this in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- STEP 1: IDENTIFY POSTS WITH CATEGORY TAGS
-- =====================================================

-- View posts with non-UUID tags (category tags)
SELECT
  id,
  caption,
  tags,
  created_at
FROM posts
WHERE
  tags IS NOT NULL
  AND array_length(tags, 1) > 0
  AND EXISTS (
    SELECT 1
    FROM unnest(tags) AS tag
    WHERE tag !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
ORDER BY created_at DESC
LIMIT 20;

-- =====================================================
-- STEP 2: BACKUP (OPTIONAL BUT RECOMMENDED)
-- =====================================================

-- Create a backup table of current tags before cleanup
CREATE TABLE IF NOT EXISTS posts_tags_backup AS
SELECT
  id,
  tags,
  created_at,
  NOW() as backup_timestamp
FROM posts
WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;

-- =====================================================
-- STEP 3: CLEAN UP NON-UUID TAGS
-- =====================================================

-- Remove all non-UUID values from tags arrays
-- This keeps valid UUIDs and removes category tags
UPDATE posts
SET tags = (
  SELECT array_agg(tag)
  FROM unnest(tags) AS tag
  WHERE tag ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
WHERE
  tags IS NOT NULL
  AND array_length(tags, 1) > 0
  AND EXISTS (
    SELECT 1
    FROM unnest(tags) AS tag
    WHERE tag !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- =====================================================
-- STEP 4: SET EMPTY ARRAYS TO NULL
-- =====================================================

-- Clean up posts where all tags were removed (set to NULL instead of empty array)
UPDATE posts
SET tags = NULL
WHERE tags = ARRAY[]::text[] OR array_length(tags, 1) = 0;

-- =====================================================
-- STEP 5: VERIFICATION
-- =====================================================

DO $$
DECLARE
  total_posts INT;
  posts_with_tags INT;
  posts_with_old_tags INT;
  cleaned_posts INT;
BEGIN
  -- Count total posts
  SELECT COUNT(*) INTO total_posts FROM posts;

  -- Count posts with tags
  SELECT COUNT(*) INTO posts_with_tags
  FROM posts
  WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;

  -- Count posts with non-UUID tags (should be 0 after cleanup)
  SELECT COUNT(*) INTO posts_with_old_tags
  FROM posts
  WHERE
    tags IS NOT NULL
    AND array_length(tags, 1) > 0
    AND EXISTS (
      SELECT 1
      FROM unnest(tags) AS tag
      WHERE tag !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    );

  -- Get number of cleaned posts from backup
  SELECT COUNT(*) INTO cleaned_posts FROM posts_tags_backup;

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    CLEANUP COMPLETE - VERIFICATION REPORT';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Total posts: %', total_posts;
  RAISE NOTICE 'Posts with tags: %', posts_with_tags;
  RAISE NOTICE 'Posts backed up: %', cleaned_posts;
  RAISE NOTICE 'Posts with old category tags remaining: %', posts_with_old_tags;
  RAISE NOTICE '';

  IF posts_with_old_tags = 0 THEN
    RAISE NOTICE '✓ SUCCESS: All category tags have been removed!';
    RAISE NOTICE '✓ posts.tags column now contains only user UUIDs';
  ELSE
    RAISE NOTICE '⚠ WARNING: % posts still have non-UUID tags', posts_with_old_tags;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'Backup table: posts_tags_backup';
  RAISE NOTICE 'To restore: UPDATE posts SET tags = ptb.tags FROM posts_tags_backup ptb WHERE posts.id = ptb.id;';
  RAISE NOTICE '';
END $$;

-- =====================================================
-- STEP 6: VIEW SAMPLE RESULTS
-- =====================================================

-- Show sample of cleaned posts
SELECT
  id,
  caption,
  tags,
  created_at
FROM posts
WHERE tags IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- =====================================================
-- OPTIONAL: DROP BACKUP TABLE
-- =====================================================
-- Uncomment after verifying cleanup is successful
-- DROP TABLE IF EXISTS posts_tags_backup;
