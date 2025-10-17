-- TEST: Verify like behavior and count accuracy
-- Run this to see the actual state when you experience double-counting

-- 1. Show all posts with their stored counts
SELECT
  'POSTS WITH STORED COUNTS' as section,
  id,
  SUBSTRING(caption, 1, 50) as caption_preview,
  likes_count as stored_likes,
  comments_count as stored_comments
FROM posts
ORDER BY created_at DESC
LIMIT 5;

-- 2. Show actual likes count from post_likes table
SELECT
  'ACTUAL LIKES FROM post_likes TABLE' as section,
  post_id,
  COUNT(*) as actual_likes_count,
  STRING_AGG(profile_id::text, ', ') as liked_by_profile_ids
FROM post_likes
GROUP BY post_id
ORDER BY post_id;

-- 3. Compare stored vs actual for all posts
SELECT
  'COMPARISON: Stored vs Actual' as section,
  p.id as post_id,
  SUBSTRING(p.caption, 1, 30) as caption,
  p.likes_count as stored_count,
  COUNT(pl.id) as actual_count,
  p.likes_count - COUNT(pl.id) as difference
FROM posts p
LEFT JOIN post_likes pl ON pl.post_id = p.id
GROUP BY p.id, p.caption, p.likes_count
ORDER BY p.created_at DESC;

-- 4. Check for any duplicate likes (should be NONE after fix)
SELECT
  'DUPLICATE LIKES CHECK' as section,
  post_id,
  profile_id,
  COUNT(*) as duplicate_count
FROM post_likes
GROUP BY post_id, profile_id
HAVING COUNT(*) > 1;

-- 5. Check trigger status
SELECT
  'TRIGGER STATUS' as section,
  tgname as trigger_name,
  tgenabled as enabled,
  tgtype as trigger_type
FROM pg_trigger
WHERE tgrelid = 'post_likes'::regclass;
