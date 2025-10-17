-- ============================================================================
-- VERIFICATION SCRIPT: Confirm RLS optimization was successful
-- ============================================================================
--
-- Purpose: Verify that all RLS policies now use (select auth.uid()) instead
--          of direct auth.uid() calls.
--
-- Run this after applying the fix script to confirm success.
-- ============================================================================

-- Check 1: Count any remaining issues
-- Expected result: 0 rows
SELECT COUNT(*) as remaining_rls_issues
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  );

-- Check 2: List any remaining problematic policies (if any)
-- Expected result: 0 rows
SELECT
  tablename,
  policyname,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  )
ORDER BY tablename, policyname;

-- Check 3: Verify optimized policies exist
-- Expected result: Should show policies with (select auth.uid())
SELECT
  tablename,
  COUNT(*) as optimized_policies_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(select auth.uid())%'
    OR with_check LIKE '%(select auth.uid())%'
  )
GROUP BY tablename
ORDER BY tablename;

-- Check 4: Summary of all RLS policies by table
SELECT
  tablename,
  COUNT(*) as total_policies,
  SUM(CASE WHEN qual LIKE '%(select auth.uid())%' OR with_check LIKE '%(select auth.uid())%' THEN 1 ELSE 0 END) as optimized_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- ============================================================================
-- INTERPRETATION:
-- ============================================================================
-- ✅ SUCCESS: remaining_rls_issues = 0
-- ⚠️  PARTIAL: remaining_rls_issues > 0 but less than before
-- ❌ FAILED: remaining_rls_issues same as before
--
-- If successful, the Supabase Performance Advisor should now show
-- significantly fewer "Auth RLS Initialization Plan" warnings.
--
-- Expected warnings cleared: 50-100
-- ============================================================================

-- Check 5: Test a sample policy works correctly
-- This should return the current user's ID (if logged in)
SELECT (select auth.uid()) as current_user_id;

-- Check 6: Verify RLS is still enabled on all tables
SELECT
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = true
ORDER BY tablename;

-- ============================================================================
-- NEXT STEPS:
-- ============================================================================
-- 1. Verify remaining_rls_issues = 0
-- 2. Check Supabase Performance Advisor - should show fewer warnings
-- 3. Test application functionality to ensure RLS still works
-- 4. If everything looks good, proceed to Phase 2 (Missing Indexes)
-- ============================================================================
