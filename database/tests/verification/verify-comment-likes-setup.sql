-- =====================================================
-- VERIFY COMMENT LIKES SETUP
-- =====================================================
-- Run this in Supabase SQL Editor to check if comment likes are properly set up

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    COMMENT LIKES VERIFICATION';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- 1. Check if comment_likes table exists
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'comment_likes')
    THEN '✓ comment_likes table exists'
    ELSE '✗ comment_likes table NOT FOUND'
  END AS table_status;

-- 2. Check if likes_count column exists on post_comments
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'post_comments'
        AND column_name = 'likes_count'
    )
    THEN '✓ likes_count column exists on post_comments'
    ELSE '✗ likes_count column NOT FOUND on post_comments'
  END AS column_status;

-- 3. Check indexes
SELECT
  indexname,
  '✓ Index exists' AS status
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'comment_likes'
ORDER BY indexname;

-- 4. Check RLS policies
SELECT
  policyname,
  '✓ Policy exists' AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'comment_likes'
ORDER BY policyname;

-- 5. Check triggers
SELECT
  trigger_name,
  event_object_table,
  '✓ Trigger exists' AS status
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND (
    event_object_table = 'comment_likes'
    OR trigger_name LIKE '%comment_like%'
  )
ORDER BY trigger_name;

-- 6. Test query (should return empty result if no data yet)
SELECT
  COUNT(*) AS total_comment_likes,
  '✓ Query works' AS status
FROM comment_likes;

-- 7. Check table structure
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'comment_likes'
ORDER BY ordinal_position;

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    VERIFICATION COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Expected results:';
  RAISE NOTICE '  ✓ comment_likes table exists';
  RAISE NOTICE '  ✓ likes_count column on post_comments';
  RAISE NOTICE '  ✓ 3 indexes (comment_id, profile_id, created_at)';
  RAISE NOTICE '  ✓ 3 RLS policies (view, insert, delete)';
  RAISE NOTICE '  ✓ 3 triggers (increment, decrement, notify)';
  RAISE NOTICE '';
  RAISE NOTICE 'If any items are missing, run: add-comment-likes.sql';
  RAISE NOTICE '';
END $$;
