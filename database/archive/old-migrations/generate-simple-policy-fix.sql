-- ============================================================================
-- SIMPLE: Generate Fix SQL for First Policy
-- ============================================================================
--
-- Purpose: Show the generated DROP and CREATE statements for one policy
--
-- ============================================================================

SELECT
  tablename,
  policyname,
  cmd,
  permissive,
  roles::text as roles,

  -- DROP statement
  format(
    'DROP POLICY IF EXISTS %I ON %I.%I;',
    policyname,
    schemaname,
    tablename
  ) as drop_sql,

  -- Full CREATE statement
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
  END || ';' as create_sql,

  -- Show original clauses
  qual as original_using_clause,
  with_check as original_with_check_clause

FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  )
ORDER BY tablename, policyname
LIMIT 3;  -- Show first 3 policies

-- ============================================================================
-- INSTRUCTIONS:
-- ============================================================================
-- 1. Run this query
-- 2. Share the entire output (especially the create_sql column)
-- 3. We'll inspect if the generated SQL is correct
-- 4. If it looks good, we can manually test by running the drop_sql and create_sql
-- ============================================================================
