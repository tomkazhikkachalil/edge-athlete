-- ============================================================================
-- DEBUG VERSION: RLS Fix with Table-Based Logging
-- ============================================================================
--
-- Purpose: Debug version that logs to a table so we can see results
--          (since Supabase doesn't show NOTICE messages)
--
-- ============================================================================

BEGIN;

-- Create temporary log table
CREATE TEMP TABLE IF NOT EXISTS rls_fix_log (
  id SERIAL PRIMARY KEY,
  step_number INTEGER,
  log_level TEXT,
  message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$
DECLARE
  policy_record RECORD;
  drop_statement TEXT;
  create_statement TEXT;
  policies_fixed INTEGER := 0;
  total_policies INTEGER := 0;
  step_counter INTEGER := 0;
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

  step_counter := step_counter + 1;
  INSERT INTO rls_fix_log (step_number, log_level, message)
  VALUES (step_counter, 'INFO', 'Starting RLS fix process');

  step_counter := step_counter + 1;
  INSERT INTO rls_fix_log (step_number, log_level, message)
  VALUES (step_counter, 'INFO', 'Found ' || total_policies || ' policies to fix');

  -- Loop through all affected policies (LIMIT 3 for debugging)
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
    LIMIT 3  -- Only process first 3 for debugging
  LOOP
    BEGIN
      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', '--- Processing policy #' || (policies_fixed + 1) || ' ---');

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'Table: ' || policy_record.tablename);

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'Policy: ' || policy_record.policyname);

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'Command: ' || policy_record.cmd);

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'Permissive: ' || policy_record.permissive);

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'Roles: ' || COALESCE(policy_record.roles::text, 'NULL'));

      -- Generate DROP statement
      drop_statement := format(
        'DROP POLICY IF EXISTS %I ON %I.%I',
        policy_record.policyname,
        policy_record.schemaname,
        policy_record.tablename
      );

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'DROP: ' || drop_statement);

      -- Execute DROP
      EXECUTE drop_statement;

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'SUCCESS', 'DROP successful');

      -- Generate CREATE statement base
      create_statement := format(
        'CREATE POLICY %I ON %I.%I',
        policy_record.policyname,
        policy_record.schemaname,
        policy_record.tablename
      );

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'Base CREATE: ' || create_statement);

      -- Add AS PERMISSIVE or AS RESTRICTIVE
      IF policy_record.permissive = 'PERMISSIVE' THEN
        create_statement := create_statement || ' AS PERMISSIVE';
      ELSE
        create_statement := create_statement || ' AS RESTRICTIVE';
      END IF;

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'After AS: ' || substring(create_statement, 1, 150));

      -- Add FOR command
      create_statement := create_statement || ' FOR ' || policy_record.cmd;

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'After FOR: ' || substring(create_statement, 1, 150));

      -- Add TO roles if specified
      IF policy_record.roles IS NOT NULL AND array_length(policy_record.roles, 1) > 0 THEN
        create_statement := create_statement || ' TO ' || array_to_string(policy_record.roles, ', ');

        step_counter := step_counter + 1;
        INSERT INTO rls_fix_log (step_number, log_level, message)
        VALUES (step_counter, 'INFO', 'After TO: ' || substring(create_statement, 1, 150));
      ELSE
        step_counter := step_counter + 1;
        INSERT INTO rls_fix_log (step_number, log_level, message)
        VALUES (step_counter, 'INFO', 'No roles to add');
      END IF;

      -- Add USING clause if exists
      IF policy_record.qual IS NOT NULL THEN
        create_statement := create_statement || ' USING (' ||
          REPLACE(
            REPLACE(policy_record.qual, 'auth.uid()', '(select auth.uid())'),
            'auth.jwt()', '(select auth.jwt())'
          ) || ')';

        step_counter := step_counter + 1;
        INSERT INTO rls_fix_log (step_number, log_level, message)
        VALUES (step_counter, 'INFO', 'After USING (length: ' || length(create_statement) || ' chars)');
      END IF;

      -- Add WITH CHECK clause if exists
      IF policy_record.with_check IS NOT NULL THEN
        create_statement := create_statement || ' WITH CHECK (' ||
          REPLACE(
            REPLACE(policy_record.with_check, 'auth.uid()', '(select auth.uid())'),
            'auth.jwt()', '(select auth.jwt())'
          ) || ')';

        step_counter := step_counter + 1;
        INSERT INTO rls_fix_log (step_number, log_level, message)
        VALUES (step_counter, 'INFO', 'After WITH CHECK (length: ' || length(create_statement) || ' chars)');
      END IF;

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'INFO', 'Full CREATE (first 300 chars): ' || substring(create_statement, 1, 300));

      -- Execute CREATE
      EXECUTE create_statement;

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'SUCCESS', 'CREATE successful! Policy fixed.');

      policies_fixed := policies_fixed + 1;

    EXCEPTION WHEN OTHERS THEN
      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'ERROR', '❌ ERROR on policy #' || (policies_fixed + 1));

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'ERROR', 'Table: ' || policy_record.tablename);

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'ERROR', 'Policy: ' || policy_record.policyname);

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'ERROR', 'Error: ' || SQLERRM);

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'ERROR', 'SQL State: ' || SQLSTATE);

      step_counter := step_counter + 1;
      INSERT INTO rls_fix_log (step_number, log_level, message)
      VALUES (step_counter, 'ERROR', 'Last statement: ' || substring(create_statement, 1, 300));

      RAISE EXCEPTION 'Stopping due to error. Check rls_fix_log table.';
    END;

  END LOOP;

  -- Final report
  step_counter := step_counter + 1;
  INSERT INTO rls_fix_log (step_number, log_level, message)
  VALUES (step_counter, 'INFO', '====================================================');

  step_counter := step_counter + 1;
  INSERT INTO rls_fix_log (step_number, log_level, message)
  VALUES (step_counter, 'INFO', 'Process completed!');

  step_counter := step_counter + 1;
  INSERT INTO rls_fix_log (step_number, log_level, message)
  VALUES (step_counter, 'INFO', 'Total policies fixed: ' || policies_fixed);

  step_counter := step_counter + 1;
  INSERT INTO rls_fix_log (step_number, log_level, message)
  VALUES (step_counter, 'INFO', 'Expected to fix: ' || total_policies || ' (limited to 3 for debug)');

  step_counter := step_counter + 1;
  INSERT INTO rls_fix_log (step_number, log_level, message)
  VALUES (step_counter, 'INFO', '====================================================');

END $$;

-- Return the log (THIS WILL SHOW IN RESULTS TAB!)
SELECT
  step_number,
  log_level,
  message,
  created_at
FROM rls_fix_log
ORDER BY step_number;

-- Also show remaining issues
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
-- 2. You'll see TWO result tabs:
--    - Tab 1: Complete log of everything that happened
--    - Tab 2: Remaining issues count
-- 3. Share the ENTIRE log table (all rows)
-- 4. This only processes first 3 policies to avoid spam
-- 5. Remember to ROLLBACK; after reviewing results
-- ============================================================================
