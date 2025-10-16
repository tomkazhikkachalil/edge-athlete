-- ============================================================================
-- DIAGNOSTIC: Analyze Unfixed RLS Policies
-- ============================================================================
--
-- Purpose: Understand WHY 168 policies weren't fixed by the automated script
--
-- This will show:
-- 1. Total count of unfixed policies
-- 2. Breakdown by auth function type (auth.uid vs auth.jwt vs both)
-- 3. Policies with USING vs WITH CHECK clauses
-- 4. Sample policy definitions for manual review
-- 5. Tables most affected
--
-- Run this in Supabase SQL Editor to diagnose the issue
-- ============================================================================

-- ============================================================================
-- PART 1: Overall Summary
-- ============================================================================

SELECT '=== TOTAL UNFIXED POLICIES ===' as section;

SELECT COUNT(*) as total_unfixed_policies
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
    OR
    (qual IS NOT NULL AND qual LIKE '%auth.jwt()%' AND qual NOT LIKE '%(select auth.jwt())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.jwt()%' AND with_check NOT LIKE '%(select auth.jwt())%')
  );

-- ============================================================================
-- PART 2: Breakdown by Auth Function Type
-- ============================================================================

SELECT '=== BREAKDOWN BY AUTH FUNCTION TYPE ===' as section;

SELECT
  CASE
    WHEN (qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%')
     AND (qual LIKE '%auth.jwt()%' OR with_check LIKE '%auth.jwt()%') THEN 'Both auth.uid() and auth.jwt()'
    WHEN qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%' THEN 'Only auth.uid()'
    WHEN qual LIKE '%auth.jwt()%' OR with_check LIKE '%auth.jwt()%' THEN 'Only auth.jwt()'
    ELSE 'Other auth functions'
  END as auth_function_type,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.%' AND qual NOT LIKE '%(select auth.%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.%' AND with_check NOT LIKE '%(select auth.%')
  )
GROUP BY auth_function_type
ORDER BY policy_count DESC;

-- ============================================================================
-- PART 3: Breakdown by Clause Type (USING vs WITH CHECK)
-- ============================================================================

SELECT '=== BREAKDOWN BY CLAUSE TYPE ===' as section;

SELECT
  CASE
    WHEN qual IS NOT NULL AND with_check IS NOT NULL THEN 'Both USING and WITH CHECK'
    WHEN qual IS NOT NULL THEN 'Only USING'
    WHEN with_check IS NOT NULL THEN 'Only WITH CHECK'
    ELSE 'Neither (shouldn\'t happen)'
  END as clause_type,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.%' AND qual NOT LIKE '%(select auth.%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.%' AND with_check NOT LIKE '%(select auth.%')
  )
GROUP BY clause_type
ORDER BY policy_count DESC;

-- ============================================================================
-- PART 4: Breakdown by Command Type (SELECT, INSERT, UPDATE, DELETE)
-- ============================================================================

SELECT '=== BREAKDOWN BY COMMAND TYPE ===' as section;

SELECT
  cmd as command_type,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.%' AND qual NOT LIKE '%(select auth.%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.%' AND with_check NOT LIKE '%(select auth.%')
  )
GROUP BY cmd
ORDER BY policy_count DESC;

-- ============================================================================
-- PART 5: Breakdown by Permissive vs Restrictive
-- ============================================================================

SELECT '=== BREAKDOWN BY POLICY TYPE ===' as section;

SELECT
  permissive as policy_type,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.%' AND qual NOT LIKE '%(select auth.%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.%' AND with_check NOT LIKE '%(select auth.%')
  )
GROUP BY permissive
ORDER BY policy_count DESC;

-- ============================================================================
-- PART 6: Most Affected Tables
-- ============================================================================

SELECT '=== MOST AFFECTED TABLES ===' as section;

SELECT
  tablename,
  COUNT(*) as unfixed_policies
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.%' AND qual NOT LIKE '%(select auth.%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.%' AND with_check NOT LIKE '%(select auth.%')
  )
GROUP BY tablename
ORDER BY unfixed_policies DESC, tablename;

-- ============================================================================
-- PART 7: Sample Policy Definitions (First 10)
-- ============================================================================

SELECT '=== SAMPLE UNFIXED POLICIES (First 10) ===' as section;

SELECT
  tablename,
  policyname,
  cmd,
  permissive,
  roles::text as roles,
  CASE
    WHEN length(qual) > 100 THEN substring(qual, 1, 100) || '...'
    ELSE qual
  END as using_clause_preview,
  CASE
    WHEN length(with_check) > 100 THEN substring(with_check, 1, 100) || '...'
    ELSE with_check
  END as with_check_clause_preview
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.%' AND qual NOT LIKE '%(select auth.%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.%' AND with_check NOT LIKE '%(select auth.%')
  )
ORDER BY tablename, policyname
LIMIT 10;

-- ============================================================================
-- PART 8: Full Policy Definition (First 3 for detailed analysis)
-- ============================================================================

SELECT '=== DETAILED POLICY EXAMPLES (First 3) ===' as section;

SELECT
  tablename,
  policyname,
  cmd,
  permissive,
  roles::text as roles,
  qual as full_using_clause,
  with_check as full_with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.%' AND qual NOT LIKE '%(select auth.%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.%' AND with_check NOT LIKE '%(select auth.%')
  )
ORDER BY tablename, policyname
LIMIT 3;

-- ============================================================================
-- PART 9: Check for Already Optimized Policies (Should be 0 if nothing committed)
-- ============================================================================

SELECT '=== ALREADY OPTIMIZED POLICIES ===' as section;

SELECT COUNT(*) as already_optimized_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(select auth.uid())%'
    OR with_check LIKE '%(select auth.uid())%'
    OR qual LIKE '%(select auth.jwt())%'
    OR with_check LIKE '%(select auth.jwt())%'
  );

-- ============================================================================
-- INSTRUCTIONS FOR NEXT STEPS
-- ============================================================================
--
-- After reviewing the results above:
--
-- 1. Check "BREAKDOWN BY AUTH FUNCTION TYPE"
--    - If you see "Only auth.jwt()", the script needs to handle jwt() too
--    - If you see "Both", the script needs to handle mixed auth calls
--
-- 2. Check "BREAKDOWN BY CLAUSE TYPE"
--    - If you see "Only WITH CHECK", verify script handles that
--
-- 3. Check "BREAKDOWN BY POLICY TYPE"
--    - If you see "RESTRICTIVE", verify script handles non-PERMISSIVE policies
--
-- 4. Review "SAMPLE UNFIXED POLICIES"
--    - Look for patterns in the policy definitions
--    - Complex logic, nested conditions, etc.
--
-- 5. Check "ALREADY OPTIMIZED POLICIES"
--    - If this is 0, confirms nothing has been committed yet
--    - If this is > 0, some policies were already optimized
--
-- Share these results with Claude to determine the fix strategy!
-- ============================================================================
