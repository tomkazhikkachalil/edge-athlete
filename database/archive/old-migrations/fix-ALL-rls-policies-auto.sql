-- ============================================================================
-- AUTOMATIC COMPREHENSIVE RLS FIX
-- ============================================================================
--
-- Purpose: Automatically fix ALL RLS policies with auth.uid() issues
--          in a single execution - no manual copy/paste needed!
--
-- This script:
-- 1. Finds ALL policies with auth.uid() performance issues
-- 2. Drops them
-- 3. Recreates them with (select auth.uid()) optimization
-- 4. Verifies the fix
--
-- SAFE: Runs in a transaction - will rollback if anything fails
--
-- Expected to fix: 66+ RLS policies across all tables
-- NOTE: Uses regex matching to correctly identify unfixed policies
--       (handles PostgreSQL's SQL normalization)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  policy_record RECORD;
  drop_statement TEXT;
  create_statement TEXT;
  policies_fixed INTEGER := 0;
BEGIN
  -- Loop through all affected policies
  -- NOTE: Using regex (~) instead of LIKE to handle PostgreSQL's normalization
  --       PostgreSQL stores (select auth.uid()) as ( SELECT auth.uid() AS uid)
  FOR policy_record IN
    SELECT
      schemaname,
      tablename,
      policyname,
      cmd,
      qual,
      with_check,
      permissive,
      roles
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
    ORDER BY tablename, policyname
  LOOP
    -- Generate DROP statement
    drop_statement := format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );

    -- Execute DROP
    EXECUTE drop_statement;

    -- Generate CREATE statement with optimized auth calls
    -- NOTE: Correct syntax order is: CREATE POLICY ... AS ... FOR ... TO ... USING ... WITH CHECK
    create_statement := format(
      'CREATE POLICY %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );

    -- Add AS PERMISSIVE or AS RESTRICTIVE (must come BEFORE FOR)
    IF policy_record.permissive = 'PERMISSIVE' THEN
      create_statement := create_statement || ' AS PERMISSIVE';
    ELSE
      create_statement := create_statement || ' AS RESTRICTIVE';
    END IF;

    -- Add FOR command
    create_statement := create_statement || ' FOR ' || policy_record.cmd;

    -- Add TO roles if specified
    IF policy_record.roles IS NOT NULL AND array_length(policy_record.roles, 1) > 0 THEN
      create_statement := create_statement || ' TO ' || array_to_string(policy_record.roles, ', ');
    END IF;

    -- Add USING clause if exists (with optimization)
    IF policy_record.qual IS NOT NULL THEN
      create_statement := create_statement || ' USING (' ||
        REPLACE(
          REPLACE(policy_record.qual, 'auth.uid()', '(select auth.uid())'),
          'auth.jwt()', '(select auth.jwt())'
        ) || ')';
    END IF;

    -- Add WITH CHECK clause if exists (with optimization)
    IF policy_record.with_check IS NOT NULL THEN
      create_statement := create_statement || ' WITH CHECK (' ||
        REPLACE(
          REPLACE(policy_record.with_check, 'auth.uid()', '(select auth.uid())'),
          'auth.jwt()', '(select auth.jwt())'
        ) || ')';
    END IF;

    -- Execute CREATE
    EXECUTE create_statement;

    policies_fixed := policies_fixed + 1;

    -- Log progress every 10 policies
    IF policies_fixed % 10 = 0 THEN
      RAISE NOTICE 'Fixed % policies so far...', policies_fixed;
    END IF;

  END LOOP;

  -- Final report
  RAISE NOTICE '====================================================';
  RAISE NOTICE 'RLS OPTIMIZATION COMPLETE';
  RAISE NOTICE '====================================================';
  RAISE NOTICE 'Total policies fixed: %', policies_fixed;
  RAISE NOTICE '';
  RAISE NOTICE 'Verifying fix...';

END $$;

-- Verify the fix (using regex to handle PostgreSQL normalization)
SELECT COUNT(*) as remaining_issues
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
  );

-- Show summary by table (policies with optimized auth calls)
SELECT
  tablename,
  COUNT(*) as optimized_policies
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    -- Has SELECT wrapping auth.uid() or auth.jwt()
    (qual IS NOT NULL AND qual ~* 'SELECT.*auth\.(uid|jwt)\(\)')
    OR
    (with_check IS NOT NULL AND with_check ~* 'SELECT.*auth\.(uid|jwt)\(\)')
  )
GROUP BY tablename
ORDER BY COUNT(*) DESC, tablename;

-- ============================================================================
-- REVIEW THE RESULTS ABOVE:
-- ============================================================================
-- 1. Check "remaining_issues" - should be 0
-- 2. Review "optimized_policies" count by table
-- 3. If remaining_issues = 0, uncomment COMMIT below
-- 4. If remaining_issues > 0, investigate with find-rls-issues.sql
-- ============================================================================

-- IMPORTANT: Only uncomment this line after verifying remaining_issues = 0
-- COMMIT;

-- To rollback instead:
-- ROLLBACK;

-- ============================================================================
-- TROUBLESHOOTING:
-- ============================================================================
-- If you see errors about specific policies, it may be due to:
-- 1. Complex policy logic that needs manual review
-- 2. Policies using other auth functions (auth.jwt(), etc.)
-- 3. Policies with special characters in names
--
-- In that case:
-- 1. Run ROLLBACK;
-- 2. Run generate-complete-rls-fix.sql to see the generated SQL
-- 3. Review and fix problematic policies manually
-- ============================================================================
