-- Database Verification Script for Likes and Comments
-- Run this in Supabase SQL Editor to verify data integrity

-- ============================================================================
-- 1. CHECK IF TABLES EXIST
-- ============================================================================
SELECT
  EXISTS (SELECT FROM pg_tables WHERE tablename = 'posts') as posts_exists,
  EXISTS (SELECT FROM pg_tables WHERE tablename = 'post_likes') as likes_exists,
  EXISTS (SELECT FROM pg_tables WHERE tablename = 'post_comments') as comments_exists;

-- ============================================================================
-- 2. CHECK IF TRIGGERS EXIST
-- ============================================================================
SELECT
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_name IN ('update_likes_count', 'update_comments_count')
ORDER BY event_object_table;

-- ============================================================================
-- 3. VERIFY COUNT ACCURACY (Should return no rows if all counts are accurate)
-- ============================================================================
SELECT
  p.id as post_id,
  p.caption,
  p.likes_count as stored_likes,
  COUNT(DISTINCT pl.id) as actual_likes,
  p.comments_count as stored_comments,
  COUNT(DISTINCT pc.id) as actual_comments,
  CASE
    WHEN p.likes_count = COUNT(DISTINCT pl.id) THEN '✓'
    ELSE '✗ MISMATCH'
  END as likes_status,
  CASE
    WHEN p.comments_count = COUNT(DISTINCT pc.id) THEN '✓'
    ELSE '✗ MISMATCH'
  END as comments_status
FROM posts p
LEFT JOIN post_likes pl ON p.id = pl.post_id
LEFT JOIN post_comments pc ON p.id = pc.post_id
GROUP BY p.id, p.caption, p.likes_count, p.comments_count
HAVING
  p.likes_count != COUNT(DISTINCT pl.id) OR
  p.comments_count != COUNT(DISTINCT pc.id);

-- If above query returns no rows: ✓ All counts are accurate!

-- ============================================================================
-- 4. CHECK FOR DUPLICATE LIKES (Should return no rows)
-- ============================================================================
SELECT
  post_id,
  profile_id,
  COUNT(*) as duplicate_count
FROM post_likes
GROUP BY post_id, profile_id
HAVING COUNT(*) > 1;

-- If above query returns no rows: ✓ No duplicate likes!

-- ============================================================================
-- 5. SAMPLE DATA VERIFICATION
-- ============================================================================
-- View posts with their actual counts
SELECT
  p.id,
  LEFT(p.caption, 50) as caption_preview,
  p.likes_count,
  p.comments_count,
  p.created_at,
  pr.full_name as author
FROM posts p
LEFT JOIN profiles pr ON p.profile_id = pr.id
ORDER BY p.created_at DESC
LIMIT 10;

-- ============================================================================
-- 6. CHECK RECENT LIKES
-- ============================================================================
SELECT
  pl.created_at,
  pr.full_name as user_who_liked,
  LEFT(p.caption, 40) as post_caption
FROM post_likes pl
LEFT JOIN profiles pr ON pl.profile_id = pr.id
LEFT JOIN posts p ON pl.post_id = p.id
ORDER BY pl.created_at DESC
LIMIT 10;

-- ============================================================================
-- 7. CHECK RECENT COMMENTS
-- ============================================================================
SELECT
  pc.created_at,
  pr.full_name as commenter,
  LEFT(pc.content, 50) as comment_preview,
  LEFT(p.caption, 30) as post_caption
FROM post_comments pc
LEFT JOIN profiles pr ON pc.profile_id = pr.id
LEFT JOIN posts p ON pc.post_id = p.id
ORDER BY pc.created_at DESC
LIMIT 10;

-- ============================================================================
-- 8. STATISTICS SUMMARY
-- ============================================================================
SELECT
  'Posts' as table_name,
  COUNT(*) as total_records
FROM posts
UNION ALL
SELECT
  'Likes',
  COUNT(*)
FROM post_likes
UNION ALL
SELECT
  'Comments',
  COUNT(*)
FROM post_comments
UNION ALL
SELECT
  'Total Likes Across All Posts',
  SUM(likes_count)
FROM posts
UNION ALL
SELECT
  'Total Comments Across All Posts',
  SUM(comments_count)
FROM posts;

-- ============================================================================
-- EXPECTED RESULTS
-- ============================================================================
-- Query 1: All should show 'true'
-- Query 2: Should show 2 triggers (update_likes_count, update_comments_count)
-- Query 3: Should return NO ROWS (all counts accurate)
-- Query 4: Should return NO ROWS (no duplicate likes)
-- Query 5-7: Shows actual data
-- Query 8: Shows statistics

-- ============================================================================
-- TROUBLESHOOTING
-- ============================================================================
-- If Query 3 returns rows (count mismatch):
-- Fix with: Run this to recalculate all counts
/*
UPDATE posts SET likes_count = (
  SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id
);
UPDATE posts SET comments_count = (
  SELECT COUNT(*) FROM post_comments WHERE post_id = posts.id
);
*/

-- If Query 4 returns rows (duplicate likes):
-- This should not happen due to UNIQUE constraint, but if it does:
/*
-- Remove duplicates, keeping the oldest one
DELETE FROM post_likes
WHERE id NOT IN (
  SELECT MIN(id)
  FROM post_likes
  GROUP BY post_id, profile_id
);
*/
