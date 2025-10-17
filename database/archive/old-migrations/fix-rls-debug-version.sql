-- ============================================================================
-- DEBUG VERSION: RLS Fix with Error Handling
-- ============================================================================
--
-- Purpose: Debug version that shows exactly where the script fails
--
-- This will output detailed information about what's happening
-- ============================================================================

BEGIN;

DO $$
DECLARE
  policy_record RECORD;
  drop_statement TEXT;
  create_statement TEXT;
  policies_fixed INTEGER := 0;
  total_policies INTEGER := 0;
BEGIN
  -- Count total policies to fix
  SELECT COUNT(*) INTO total_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
      OR
      (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
    );

  RAISE NOTICE '====================================================';
  RAISE NOTICE 'DEBUG: Starting RLS fix process';
  RAISE NOTICE 'DEBUG: Found % policies to fix', total_policies;
  RAISE NOTICE '====================================================';

  -- Loop through all affected policies
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
        (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
        OR
        (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
      )
    ORDER BY tablename, policyname
    LIMIT 5  -- Only process first 5 for debugging
  LOOP
    BEGIN
      RAISE NOTICE '';
      RAISE NOTICE 'DEBUG: Processing policy #%', policies_fixed + 1;
      RAISE NOTICE 'DEBUG:   Table: %', policy_record.tablename;
      RAISE NOTICE 'DEBUG:   Policy: %', policy_record.policyname;
      RAISE NOTICE 'DEBUG:   Command: %', policy_record.cmd;
      RAISE NOTICE 'DEBUG:   Permissive: %', policy_record.permissive;
      RAISE NOTICE 'DEBUG:   Roles: %', policy_record.roles::text;

      -- Generate DROP statement
      drop_statement := format(
        'DROP POLICY IF EXISTS %I ON %I.%I',
        policy_record.policyname,
        policy_record.schemaname,
        policy_record.tablename
      );

      RAISE NOTICE 'DEBUG:   DROP statement: %', drop_statement;

      -- Execute DROP
      EXECUTE drop_statement;
      RAISE NOTICE 'DEBUG:   ✓ DROP successful';

      -- Generate CREATE statement base
      create_statement := format(
        'CREATE POLICY %I ON %I.%I',
        policy_record.policyname,
        policy_record.schemaname,
        policy_record.tablename
      );
      RAISE NOTICE 'DEBUG:   Base CREATE: %', create_statement;

      -- Add AS PERMISSIVE or AS RESTRICTIVE
      IF policy_record.permissive = 'PERMISSIVE' THEN
        create_statement := create_statement || ' AS PERMISSIVE';
      ELSE
        create_statement := create_statement || ' AS RESTRICTIVE';
      END IF;
      RAISE NOTICE 'DEBUG:   After AS: %', create_statement;

      -- Add FOR command
      create_statement := create_statement || ' FOR ' || policy_record.cmd;
      RAISE NOTICE 'DEBUG:   After FOR: %', create_statement;

      -- Add TO roles if specified
      IF policy_record.roles IS NOT NULL AND array_length(policy_record.roles, 1) > 0 THEN
        create_statement := create_statement || ' TO ' || array_to_string(policy_record.roles, ', ');
        RAISE NOTICE 'DEBUG:   After TO: %', create_statement;
      ELSE
        RAISE NOTICE 'DEBUG:   No roles to add';
      END IF;

      -- Add USING clause if exists
      IF policy_record.qual IS NOT NULL THEN
        create_statement := create_statement || ' USING (' ||
          REPLACE(
            REPLACE(policy_record.qual, 'auth.uid()', '(select auth.uid())'),
            'auth.jwt()', '(select auth.jwt())'
          ) || ')';
        RAISE NOTICE 'DEBUG:   After USING (first 100 chars): %', substring(create_statement, 1, 100);
      END IF;

      -- Add WITH CHECK clause if exists
      IF policy_record.with_check IS NOT NULL THEN
        create_statement := create_statement || ' WITH CHECK (' ||
          REPLACE(
            REPLACE(policy_record.with_check, 'auth.uid()', '(select auth.uid())'),
            'auth.jwt()', '(select auth.jwt())'
          ) || ')';
        RAISE NOTICE 'DEBUG:   After WITH CHECK (first 100 chars): %', substring(create_statement, 1, 100);
      END IF;

      RAISE NOTICE 'DEBUG:   Full CREATE statement length: % characters', length(create_statement);

      -- Execute CREATE
      EXECUTE create_statement;
      RAISE NOTICE 'DEBUG:   ✓ CREATE successful';

      policies_fixed := policies_fixed + 1;
      RAISE NOTICE 'DEBUG: ✓✓✓ Policy #% fixed successfully', policies_fixed;

    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'DEBUG: ❌❌❌ ERROR on policy #%', policies_fixed + 1;
      RAISE NOTICE 'DEBUG:   Table: %', policy_record.tablename;
      RAISE NOTICE 'DEBUG:   Policy: %', policy_record.policyname;
      RAISE NOTICE 'DEBUG:   Error: %', SQLERRM;
      RAISE NOTICE 'DEBUG:   SQL State: %', SQLSTATE;
      RAISE NOTICE 'DEBUG:   Last statement attempted: %', substring(create_statement, 1, 200);
      RAISE EXCEPTION 'Stopping due to error. See debug output above.';
    END;

  END LOOP;

  -- Final report
  RAISE NOTICE '';
  RAISE NOTICE '====================================================';
  RAISE NOTICE 'DEBUG: Process completed';
  RAISE NOTICE 'DEBUG: Total policies fixed: %', policies_fixed;
  RAISE NOTICE 'DEBUG: Expected to fix: % (limited to 5 for debug)', total_policies;
  RAISE NOTICE '====================================================';

END $$;

-- Verify
SELECT COUNT(*) as remaining_issues
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  );

-- ============================================================================
-- INSTRUCTIONS:
-- ============================================================================
-- 1. Run this script
-- 2. Look for the NOTICE messages (should be in "Messages" panel)
-- 3. Share ALL the DEBUG output
-- 4. This will only process first 5 policies to avoid spam
-- 5. Once we see where it fails, we can fix the main script
-- 6. Remember to ROLLBACK; after reviewing results
-- ============================================================================
