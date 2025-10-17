-- ============================================================================
-- GENERATE ALL RLS FIX STATEMENTS (No DO Block)
-- ============================================================================
--
-- Purpose: Generate DROP and CREATE statements for ALL 66 unfixed policies
--          as plain SQL that can be copied and run directly
--
-- This avoids the DO block issue in Supabase SQL Editor
--
-- INSTRUCTIONS:
-- 1. Run this script
-- 2. Copy ALL the generated SQL from the 'fix_sql' column
-- 3. Paste into a new SQL Editor tab
-- 4. Wrap with BEGIN; ... COMMIT; and run
-- ============================================================================

SELECT
  row_number() OVER (ORDER BY tablename, policyname) as policy_number,
  tablename,
  policyname,

  -- Generate DROP statement
  format('DROP POLICY IF EXISTS %I ON %I.%I;', policyname, schemaname, tablename) || E'\n' ||

  -- Generate CREATE statement
  format('CREATE POLICY %I ON %I.%I', policyname, schemaname, tablename) ||
  ' AS ' || permissive ||
  ' FOR ' || cmd ||
  CASE
    WHEN roles IS NOT NULL AND array_length(roles, 1) > 0
    THEN ' TO ' || array_to_string(roles, ', ')
    ELSE ''
  END ||
  CASE
    WHEN qual IS NOT NULL
    THEN ' USING (' || REPLACE(REPLACE(qual, 'auth.uid()', '(select auth.uid())'), 'auth.jwt()', '(select auth.jwt())') || ')'
    ELSE ''
  END ||
  CASE
    WHEN with_check IS NOT NULL
    THEN ' WITH CHECK (' || REPLACE(REPLACE(with_check, 'auth.uid()', '(select auth.uid())'), 'auth.jwt()', '(select auth.jwt())') || ')'
    ELSE ''
  END || ';' || E'\n'

  as fix_sql

FROM pg_policies
WHERE schemaname = 'public'
  AND (
    -- qual has auth.uid() without SELECT wrapping
    (qual IS NOT NULL AND qual ~ 'auth\.uid\(\)' AND qual !~* 'SELECT.*auth\.uid\(\)')
    OR
    -- with_check has auth.uid() without SELECT wrapping
    (with_check IS NOT NULL AND with_check ~ 'auth\.uid\(\)' AND with_check !~* 'SELECT.*auth\.uid\(\)')
    OR
    -- Same for auth.jwt()
    (qual IS NOT NULL AND qual ~ 'auth\.jwt\(\)' AND qual !~* 'SELECT.*auth\.jwt\(\)')
    OR
    (with_check IS NOT NULL AND with_check ~ 'auth\.jwt\(\)' AND with_check !~* 'SELECT.*auth\.jwt\(\)')
  )
ORDER BY tablename, policyname;

-- ============================================================================
-- NEXT STEPS:
-- ============================================================================
-- 1. You should see 66 rows with generated SQL
-- 2. Copy ALL the SQL from the 'fix_sql' column
-- 3. Create a new SQL query like this:
--
--    BEGIN;
--
--    [paste all the fix_sql here]
--
--    -- Verify
--    SELECT COUNT(*) as remaining_issues
--    FROM pg_policies
--    WHERE schemaname = 'public'
--      AND (
--        (qual IS NOT NULL AND qual ~ 'auth\.uid\(\)' AND qual !~* 'SELECT.*auth\.uid\(\)')
--        OR
--        (with_check IS NOT NULL AND with_check ~ 'auth\.uid\(\)' AND with_check !~* 'SELECT.*auth\.uid\(\)')
--        OR
--        (qual IS NOT NULL AND qual ~ 'auth\.jwt\(\)' AND qual !~* 'SELECT.*auth\.jwt\(\)')
--        OR
--        (with_check IS NOT NULL AND with_check ~ 'auth\.jwt\(\)' AND with_check !~* 'SELECT.*auth\.jwt\(\)')
--      );
--
--    -- If remaining_issues = 0, then uncomment and run:
--    -- COMMIT;
--
-- ============================================================================
