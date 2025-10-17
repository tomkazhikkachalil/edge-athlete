-- ============================================
-- RLS OPTIMIZATION VERIFICATION SCRIPT
-- ============================================
-- Run this AFTER applying optimize-all-rls-policies.sql
-- This confirms all policies were optimized correctly
-- ============================================

-- ============================================
-- PART 1: Count Optimized vs Unoptimized Policies
-- ============================================

SELECT '=== OPTIMIZATION STATUS ===' as section;

-- Total policies
SELECT
  'Total RLS Policies' as metric,
  COUNT(*) as count
FROM pg_policies
WHERE schemaname = 'public';

-- Optimized policies (using subquery pattern)
SELECT
  'Optimized Policies (using subquery)' as metric,
  COUNT(*) as count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(select auth.uid())%' OR
    with_check LIKE '%(select auth.uid())%'
  );

-- Unoptimized policies (still using direct auth.uid())
SELECT
  'Unoptimized Policies (still direct)' as metric,
  COUNT(*) as count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  );

-- ============================================
-- PART 2: List Any Remaining Unoptimized Policies
-- ============================================

SELECT '=== REMAINING UNOPTIMIZED POLICIES ===' as section;

SELECT
  tablename,
  policyname,
  cmd,
  CASE
    WHEN length(qual) > 80 THEN substring(qual, 1, 80) || '...'
    ELSE qual
  END as using_clause_preview
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  )
ORDER BY tablename, policyname;

-- ============================================
-- PART 3: Verify Critical Tables
-- ============================================

SELECT '=== CRITICAL TABLE VERIFICATION ===' as section;

-- Check specific high-priority tables
SELECT
  tablename,
  COUNT(*) as total_policies,
  SUM(CASE
    WHEN qual LIKE '%(select auth.uid())%' OR with_check LIKE '%(select auth.uid())%'
    THEN 1 ELSE 0
  END) as optimized_policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles',
    'posts',
    'post_likes',
    'post_comments',
    'follows',
    'notifications',
    'golf_rounds',
    'group_posts',
    'group_post_participants'
  )
GROUP BY tablename
ORDER BY tablename;

-- ============================================
-- PART 4: Sample Optimized Policies
-- ============================================

SELECT '=== SAMPLE OPTIMIZED POLICIES (First 5) ===' as section;

SELECT
  tablename,
  policyname,
  cmd,
  CASE
    WHEN length(qual) > 100 THEN substring(qual, 1, 100) || '...'
    ELSE qual
  END as using_clause_preview
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(select auth.uid())%' OR
    with_check LIKE '%(select auth.uid())%'
  )
ORDER BY tablename, policyname
LIMIT 5;

-- ============================================
-- PART 5: Performance Advisor Check
-- ============================================

SELECT '=== PERFORMANCE ADVISOR STATUS ===' as section;

SELECT
  'Go to Supabase Dashboard → Database → Performance Advisor' as instruction,
  'Expected Result: Warnings reduced from 292 to near-zero' as expected_result,
  'Look for: Auth RLS Initialization Plan warnings should be gone' as what_to_check;

-- ============================================
-- INSTRUCTIONS
-- ============================================

SELECT '=== VERIFICATION COMPLETE ===' as section;

SELECT
  '1. Check the counts above' as step_1,
  '2. "Optimized Policies" should be 70-80+' as step_2,
  '3. "Unoptimized Policies" should be 0-5 (only non-critical ones)' as step_3,
  '4. Check Performance Advisor in Supabase Dashboard' as step_4,
  '5. Warnings should be reduced from 292 to <20' as step_5;
