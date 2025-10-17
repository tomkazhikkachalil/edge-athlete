-- DIAGNOSTIC: Check Likes and Comments Database State
-- Run this in Supabase SQL Editor to diagnose issues

-- =====================================================
-- 1. CHECK POST_LIKES TABLE STRUCTURE AND CONSTRAINTS
-- =====================================================

SELECT 'POST_LIKES TABLE STRUCTURE' as check_name;
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'post_likes'
ORDER BY ordinal_position;

-- Check unique constraint on post_likes
SELECT 'POST_LIKES UNIQUE CONSTRAINT' as check_name;
SELECT
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'post_likes'
  AND con.contype = 'u'; -- unique constraints

-- =====================================================
-- 2. CHECK FOR DUPLICATE LIKES
-- =====================================================

SELECT 'DUPLICATE LIKES CHECK' as check_name;
SELECT
  post_id,
  profile_id,
  COUNT(*) as like_count,
  STRING_AGG(id::text, ', ') as duplicate_ids
FROM post_likes
GROUP BY post_id, profile_id
HAVING COUNT(*) > 1;

-- =====================================================
-- 3. CHECK POST_COMMENTS TABLE STRUCTURE
-- =====================================================

SELECT 'POST_COMMENTS TABLE STRUCTURE' as check_name;
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'post_comments'
ORDER BY ordinal_position;

-- =====================================================
-- 4. CHECK ALL COMMENTS (VERIFY THEY EXIST)
-- =====================================================

SELECT 'ALL COMMENTS COUNT' as check_name;
SELECT COUNT(*) as total_comments FROM post_comments;

SELECT 'RECENT COMMENTS' as check_name;
SELECT
  pc.id,
  pc.post_id,
  pc.profile_id,
  pc.content,
  pc.created_at,
  p.full_name as commenter_name
FROM post_comments pc
LEFT JOIN profiles p ON p.id = pc.profile_id
ORDER BY pc.created_at DESC
LIMIT 20;

-- =====================================================
-- 5. CHECK LIKES COUNT VS ACTUAL LIKES
-- =====================================================

SELECT 'LIKES COUNT ACCURACY CHECK' as check_name;
SELECT
  posts.id as post_id,
  posts.likes_count as stored_count,
  COUNT(post_likes.id) as actual_count,
  posts.likes_count - COUNT(post_likes.id) as difference
FROM posts
LEFT JOIN post_likes ON post_likes.post_id = posts.id
GROUP BY posts.id, posts.likes_count
HAVING posts.likes_count != COUNT(post_likes.id)
ORDER BY ABS(posts.likes_count - COUNT(post_likes.id)) DESC
LIMIT 10;

-- =====================================================
-- 6. CHECK COMMENTS COUNT VS ACTUAL COMMENTS
-- =====================================================

SELECT 'COMMENTS COUNT ACCURACY CHECK' as check_name;
SELECT
  posts.id as post_id,
  posts.comments_count as stored_count,
  COUNT(post_comments.id) as actual_count,
  posts.comments_count - COUNT(post_comments.id) as difference
FROM posts
LEFT JOIN post_comments ON post_comments.post_id = posts.id
GROUP BY posts.id, posts.comments_count
HAVING posts.comments_count != COUNT(post_comments.id)
ORDER BY ABS(posts.comments_count - COUNT(post_comments.id)) DESC
LIMIT 10;

-- =====================================================
-- 7. CHECK DATABASE TRIGGERS
-- =====================================================

SELECT 'DATABASE TRIGGERS FOR LIKES' as check_name;
SELECT
  tgname as trigger_name,
  tgenabled as enabled,
  pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger
WHERE tgrelid = 'post_likes'::regclass;

SELECT 'DATABASE TRIGGERS FOR COMMENTS' as check_name;
SELECT
  tgname as trigger_name,
  tgenabled as enabled,
  pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger
WHERE tgrelid = 'post_comments'::regclass;

-- =====================================================
-- 8. CHECK RLS POLICIES ON POST_LIKES
-- =====================================================

SELECT 'RLS POLICIES ON POST_LIKES' as check_name;
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'post_likes';

-- =====================================================
-- 9. CHECK RLS POLICIES ON POST_COMMENTS
-- =====================================================

SELECT 'RLS POLICIES ON POST_COMMENTS' as check_name;
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'post_comments';

-- =====================================================
-- 10. SAMPLE DATA CHECK
-- =====================================================

SELECT 'SAMPLE POST WITH LIKES AND COMMENTS' as check_name;
SELECT
  p.id as post_id,
  p.caption,
  p.likes_count,
  p.comments_count,
  COUNT(DISTINCT pl.id) as actual_likes,
  COUNT(DISTINCT pc.id) as actual_comments,
  STRING_AGG(DISTINCT prof_like.full_name, ', ') as liked_by,
  STRING_AGG(DISTINCT prof_comment.full_name, ', ') as commented_by
FROM posts p
LEFT JOIN post_likes pl ON pl.post_id = p.id
LEFT JOIN post_comments pc ON pc.post_id = p.id
LEFT JOIN profiles prof_like ON prof_like.id = pl.profile_id
LEFT JOIN profiles prof_comment ON prof_comment.id = pc.profile_id
GROUP BY p.id, p.caption, p.likes_count, p.comments_count
ORDER BY p.created_at DESC
LIMIT 5;

-- =====================================================
-- END OF DIAGNOSTICS
-- =====================================================

SELECT '✅ Diagnostic complete!' as status;
