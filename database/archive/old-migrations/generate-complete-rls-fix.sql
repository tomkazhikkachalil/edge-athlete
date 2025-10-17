-- ============================================================================
-- COMPREHENSIVE RLS FIX GENERATOR
-- ============================================================================
--
-- Purpose: Automatically generate fix statements for ALL RLS policies that
--          need auth.uid() optimization, not just the known ones.
--
-- This script will output the exact SQL needed to fix ALL 168+ remaining issues.
--
-- INSTRUCTIONS:
-- 1. Run this script in Supabase SQL Editor
-- 2. Copy the output (it will be a series of DROP/CREATE statements)
-- 3. Review the generated SQL
-- 4. Run the generated SQL to apply the fixes
-- ============================================================================

-- This query generates DROP and CREATE statements for all affected policies
SELECT
  '-- ============================================================================' || E'\n' ||
  '-- TABLE: ' || tablename || E'\n' ||
  '-- ============================================================================' || E'\n\n' ||

  -- Generate DROP statement
  'DROP POLICY IF EXISTS "' || policyname || '" ON public.' || tablename || ';' || E'\n\n' ||

  -- Generate CREATE statement with optimized auth.uid()
  'CREATE POLICY "' || policyname || '"' || E'\n' ||
  'ON public.' || tablename || E'\n' ||
  'FOR ' || cmd || E'\n' ||
  CASE
    WHEN qual IS NOT NULL AND with_check IS NOT NULL THEN
      'USING (' || REPLACE(REPLACE(qual, 'auth.uid()', '(select auth.uid())'), 'auth.jwt()', '(select auth.jwt())') || ')' || E'\n' ||
      'WITH CHECK (' || REPLACE(REPLACE(with_check, 'auth.uid()', '(select auth.uid())'), 'auth.jwt()', '(select auth.jwt())') || ');'
    WHEN qual IS NOT NULL THEN
      'USING (' || REPLACE(REPLACE(qual, 'auth.uid()', '(select auth.uid())'), 'auth.jwt()', '(select auth.jwt())') || ');'
    WHEN with_check IS NOT NULL THEN
      'WITH CHECK (' || REPLACE(REPLACE(with_check, 'auth.uid()', '(select auth.uid())'), 'auth.jwt()', '(select auth.jwt())') || ');'
    ELSE
      ';'
  END || E'\n\n' AS fix_statement

FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  )
ORDER BY tablename, policyname;

-- ============================================================================
-- USAGE:
-- ============================================================================
-- 1. The output will be a list of DROP and CREATE statements
-- 2. Copy ALL the output
-- 3. Wrap it in a transaction:
--    BEGIN;
--    [paste generated statements here]
--    COMMIT;
-- 4. Run the transaction
-- 5. Verify with: SELECT COUNT(*) FROM pg_policies WHERE ...
-- ============================================================================

-- After running the generated SQL, verify with this:
-- SELECT COUNT(*) as remaining_issues
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND (
--     (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
--     OR
--     (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
--   );
