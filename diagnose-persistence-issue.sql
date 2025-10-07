-- =====================================================
-- DIAGNOSE PERSISTENCE ISSUE FOR COMMENTS AND LIKES
-- =====================================================
-- This script checks why data might not be persisting

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    PERSISTENCE DIAGNOSTIC REPORT';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- =====================================================
-- PART 1: CHECK IF DATA EXISTS
-- =====================================================

-- Check post_comments
SELECT
  'POST COMMENTS' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT profile_id) AS unique_users,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM post_comments;

-- Check post_likes
SELECT
  'POST LIKES' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT profile_id) AS unique_users,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM post_likes;

-- Check comment_likes
SELECT
  'COMMENT LIKES' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT profile_id) AS unique_users,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM comment_likes;

-- =====================================================
-- PART 2: CHECK RLS POLICIES
-- =====================================================

-- RLS policies for post_comments
SELECT
  'POST_COMMENTS RLS' AS section,
  policyname,
  cmd AS command,
  qual AS using_clause,
  with_check AS check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'post_comments'
ORDER BY policyname;

-- RLS policies for post_likes
SELECT
  'POST_LIKES RLS' AS section,
  policyname,
  cmd AS command,
  qual AS using_clause,
  with_check AS check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'post_likes'
ORDER BY policyname;

-- RLS policies for comment_likes
SELECT
  'COMMENT_LIKES RLS' AS section,
  policyname,
  cmd AS command,
  qual AS using_clause,
  with_check AS check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'comment_likes'
ORDER BY policyname;

-- =====================================================
-- PART 3: CHECK TABLE STRUCTURE
-- =====================================================

-- post_comments structure
SELECT
  'POST_COMMENTS SCHEMA' AS section,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'post_comments'
ORDER BY ordinal_position;

-- Check if updated_at triggers exist
SELECT
  'UPDATED_AT TRIGGERS' AS section,
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE '%updated_at%'
ORDER BY event_object_table;

-- =====================================================
-- PART 4: CHECK FOR RECENT ACTIVITY
-- =====================================================

-- Recent comments (last 7 days)
SELECT
  'RECENT COMMENTS (7 days)' AS section,
  DATE(created_at) AS date,
  COUNT(*) AS count
FROM post_comments
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Recent post likes (last 7 days)
SELECT
  'RECENT POST LIKES (7 days)' AS section,
  DATE(created_at) AS date,
  COUNT(*) AS count
FROM post_likes
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Recent comment likes (last 7 days)
SELECT
  'RECENT COMMENT LIKES (7 days)' AS section,
  DATE(created_at) AS date,
  COUNT(*) AS count
FROM comment_likes
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- =====================================================
-- PART 5: TEST INSERT CAPABILITY
-- =====================================================

-- Check if current user can insert (this won't actually insert)
DO $$
DECLARE
  can_insert_comments BOOLEAN;
  can_insert_likes BOOLEAN;
  can_insert_comment_likes BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Checking insert permissions...';

  -- Check comments
  BEGIN
    PERFORM 1 FROM post_comments LIMIT 1;
    can_insert_comments := TRUE;
  EXCEPTION WHEN OTHERS THEN
    can_insert_comments := FALSE;
  END;

  -- Check post_likes
  BEGIN
    PERFORM 1 FROM post_likes LIMIT 1;
    can_insert_likes := TRUE;
  EXCEPTION WHEN OTHERS THEN
    can_insert_likes := FALSE;
  END;

  -- Check comment_likes
  BEGIN
    PERFORM 1 FROM comment_likes LIMIT 1;
    can_insert_comment_likes := TRUE;
  EXCEPTION WHEN OTHERS THEN
    can_insert_comment_likes := FALSE;
  END;

  RAISE NOTICE 'Can read post_comments: %', can_insert_comments;
  RAISE NOTICE 'Can read post_likes: %', can_insert_likes;
  RAISE NOTICE 'Can read comment_likes: %', can_insert_comment_likes;
  RAISE NOTICE '';
END $$;

-- =====================================================
-- PART 6: CHECK FOR DELETION TRIGGERS OR POLICIES
-- =====================================================

-- Check for any CASCADE deletes that might be cleaning up data
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
LEFT JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('post_comments', 'post_likes', 'comment_likes')
ORDER BY tc.table_name;

-- =====================================================
-- SUMMARY
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    DIAGNOSTIC COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Review the output above to identify:';
  RAISE NOTICE '  1. Total row counts (should NOT be 0 if data was added)';
  RAISE NOTICE '  2. Oldest/newest timestamps (should show historical data)';
  RAISE NOTICE '  3. RLS policies (might be blocking inserts)';
  RAISE NOTICE '  4. Foreign key CASCADE rules (might be auto-deleting)';
  RAISE NOTICE '  5. Recent activity (should show data from previous days)';
  RAISE NOTICE '';
  RAISE NOTICE 'Common issues:';
  RAISE NOTICE '  - If total_rows = 0: Data never saved or was deleted';
  RAISE NOTICE '  - If no RLS policies exist: Might need to create them';
  RAISE NOTICE '  - If CASCADE DELETE on profiles: User deletion removes all data';
  RAISE NOTICE '  - If recent activity empty: No data added recently';
  RAISE NOTICE '';
END $$;
