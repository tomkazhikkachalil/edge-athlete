-- Quick diagnostic: Check if counts columns and triggers exist
-- Run this first to diagnose the issue

-- 1. Check if count columns exist
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'likes_count'
  ) as likes_count_exists,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'comments_count'
  ) as comments_count_exists;

-- 2. If columns exist, check sample data
SELECT
  id,
  LEFT(caption, 30) as caption,
  likes_count,
  comments_count,
  created_at
FROM posts
ORDER BY created_at DESC
LIMIT 5;

-- 3. Check if triggers exist
SELECT
  trigger_name,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name IN ('update_likes_count', 'update_comments_count');

-- INTERPRETATION:
-- If Query 1 shows 'false': Columns don't exist → Run fix-post-counts.sql
-- If Query 2 shows NULL values: Counts not initialized → Run fix-post-counts.sql
-- If Query 3 shows no results: Triggers not installed → Run fix-post-counts.sql
