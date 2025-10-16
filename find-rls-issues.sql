-- ============================================================================
-- DISCOVERY SCRIPT: Find all RLS policies with auth.uid() performance issues
-- ============================================================================
--
-- Purpose: Identify all Row Level Security policies that call auth.uid()
--          directly instead of using (select auth.uid()), which causes
--          the auth function to be re-evaluated for EVERY row.
--
-- Impact: This causes severe performance degradation at scale.
--
-- Run this first to see how many policies need fixing.
-- ============================================================================

-- Count total policies with issues
SELECT
  COUNT(*) as total_policies_needing_fix,
  COUNT(DISTINCT tablename) as total_tables_affected
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  );

-- List all affected policies with details
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  CASE
    WHEN qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%' THEN 'QUAL has issue'
    ELSE ''
  END as qual_issue,
  CASE
    WHEN with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%' THEN 'WITH CHECK has issue'
    ELSE ''
  END as with_check_issue,
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

-- Summary by table
SELECT
  tablename,
  COUNT(*) as policies_needing_fix,
  STRING_AGG(policyname, ', ' ORDER BY policyname) as policy_names
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  )
GROUP BY tablename
ORDER BY COUNT(*) DESC, tablename;

-- ============================================================================
-- INSTRUCTIONS:
-- ============================================================================
-- 1. Run this script in Supabase SQL Editor
-- 2. Note the "total_policies_needing_fix" count
-- 3. Review the list of affected tables and policies
-- 4. This information will be used to generate the fix script
-- 5. Share the results to proceed with the fix
-- ============================================================================
