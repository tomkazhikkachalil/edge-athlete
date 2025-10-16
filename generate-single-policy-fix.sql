-- ============================================================================
-- GENERATE FIX FOR SINGLE POLICY (No Execution)
-- ============================================================================
--
-- Purpose: Generate the DROP/CREATE SQL for ONE policy to inspect it
--          WITHOUT executing anything
--
-- ============================================================================

WITH first_policy AS (
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
  LIMIT 1
),
generated_sql AS (
  SELECT
    -- Policy info
    tablename,
    policyname,
    cmd,
    permissive,
    roles::text as roles_array,

    -- DROP statement
    format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      policyname,
      schemaname,
      tablename
    ) as drop_statement,

    -- CREATE statement (step by step)
    format(
      'CREATE POLICY %I ON %I.%I',
      policyname,
      schemaname,
      tablename
    ) as create_base,

    -- Add AS clause
    format(
      'CREATE POLICY %I ON %I.%I AS %s',
      policyname,
      schemaname,
      tablename,
      permissive
    ) as create_with_as,

    -- Add FOR clause
    format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s',
      policyname,
      schemaname,
      tablename,
      permissive,
      cmd
    ) as create_with_for,

    -- Add TO clause
    CASE
      WHEN roles IS NOT NULL AND array_length(roles, 1) > 0 THEN
        format(
          'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
          policyname,
          schemaname,
          tablename,
          permissive,
          cmd,
          array_to_string(roles, ', ')
        )
      ELSE
        format(
          'CREATE POLICY %I ON %I.%I AS %s FOR %s',
          policyname,
          schemaname,
          tablename,
          permissive,
          cmd
        )
    END as create_with_to,

    -- Add USING clause
    CASE
      WHEN qual IS NOT NULL THEN
        CASE
          WHEN roles IS NOT NULL AND array_length(roles, 1) > 0 THEN
            format(
              'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s USING (%s)',
              policyname,
              schemaname,
              tablename,
              permissive,
              cmd,
              array_to_string(roles, ', '),
              REPLACE(
                REPLACE(qual, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              )
            )
          ELSE
            format(
              'CREATE POLICY %I ON %I.%I AS %s FOR %s USING (%s)',
              policyname,
              schemaname,
              tablename,
              permissive,
              cmd,
              REPLACE(
                REPLACE(qual, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              )
            )
        END
      ELSE
        create_with_to
    END as create_with_using,

    -- Full statement
    CASE
      WHEN qual IS NOT NULL AND with_check IS NOT NULL THEN
        CASE
          WHEN roles IS NOT NULL AND array_length(roles, 1) > 0 THEN
            format(
              'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s USING (%s) WITH CHECK (%s);',
              policyname,
              schemaname,
              tablename,
              permissive,
              cmd,
              array_to_string(roles, ', '),
              REPLACE(
                REPLACE(qual, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              ),
              REPLACE(
                REPLACE(with_check, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              )
            )
          ELSE
            format(
              'CREATE POLICY %I ON %I.%I AS %s FOR %s USING (%s) WITH CHECK (%s);',
              policyname,
              schemaname,
              tablename,
              permissive,
              cmd,
              REPLACE(
                REPLACE(qual, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              ),
              REPLACE(
                REPLACE(with_check, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              )
            )
        END
      WHEN qual IS NOT NULL THEN
        CASE
          WHEN roles IS NOT NULL AND array_length(roles, 1) > 0 THEN
            format(
              'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s USING (%s);',
              policyname,
              schemaname,
              tablename,
              permissive,
              cmd,
              array_to_string(roles, ', '),
              REPLACE(
                REPLACE(qual, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              )
            )
          ELSE
            format(
              'CREATE POLICY %I ON %I.%I AS %s FOR %s USING (%s);',
              policyname,
              schemaname,
              tablename,
              permissive,
              cmd,
              REPLACE(
                REPLACE(qual, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              )
            )
        END
      WHEN with_check IS NOT NULL THEN
        CASE
          WHEN roles IS NOT NULL AND array_length(roles, 1) > 0 THEN
            format(
              'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s WITH CHECK (%s);',
              policyname,
              schemaname,
              tablename,
              permissive,
              cmd,
              array_to_string(roles, ', '),
              REPLACE(
                REPLACE(with_check, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              )
            )
          ELSE
            format(
              'CREATE POLICY %I ON %I.%I AS %s FOR %s WITH CHECK (%s);',
              policyname,
              schemaname,
              tablename,
              permissive,
              cmd,
              REPLACE(
                REPLACE(with_check, 'auth.uid()', '(select auth.uid())'),
                'auth.jwt()', '(select auth.jwt())'
              )
            )
        END
    END as final_create_statement,

    -- Original clauses for comparison
    qual as original_using,
    with_check as original_with_check

  FROM first_policy
)
SELECT
  'POLICY INFO' as section,
  tablename,
  policyname,
  cmd,
  permissive,
  roles_array
FROM generated_sql
UNION ALL
SELECT
  'DROP STATEMENT' as section,
  drop_statement as tablename,
  '' as policyname,
  '' as cmd,
  '' as permissive,
  '' as roles_array
FROM generated_sql
UNION ALL
SELECT
  'CREATE (Base)' as section,
  create_base as tablename,
  '' as policyname,
  '' as cmd,
  '' as permissive,
  '' as roles_array
FROM generated_sql
UNION ALL
SELECT
  'CREATE (+ AS)' as section,
  create_with_as as tablename,
  '' as policyname,
  '' as cmd,
  '' as permissive,
  '' as roles_array
FROM generated_sql
UNION ALL
SELECT
  'CREATE (+ FOR)' as section,
  create_with_for as tablename,
  '' as policyname,
  '' as cmd,
  '' as permissive,
  '' as roles_array
FROM generated_sql
UNION ALL
SELECT
  'CREATE (+ TO)' as section,
  create_with_to as tablename,
  '' as policyname,
  '' as cmd,
  '' as permissive,
  '' as roles_array
FROM generated_sql
UNION ALL
SELECT
  'FINAL CREATE' as section,
  final_create_statement as tablename,
  '' as policyname,
  '' as cmd,
  '' as permissive,
  '' as roles_array
FROM generated_sql;

-- ============================================================================
-- INSTRUCTIONS:
-- ============================================================================
-- 1. Run this query
-- 2. You'll see the generated DROP and CREATE statements
-- 3. Share the entire output
-- 4. We can inspect if the SQL syntax is correct
-- 5. Then manually test it by copying the statements
-- ============================================================================
