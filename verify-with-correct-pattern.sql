-- ============================================================================
-- CORRECTED VERIFICATION: Handle PostgreSQL Normalization
-- ============================================================================
--
-- Purpose: Check for unfixed policies using case-insensitive matching
--          PostgreSQL normalizes SQL, so we need to handle:
--          - Uppercase vs lowercase
--          - Added "AS uid" clauses
--
-- ============================================================================

-- Show policies that are ACTUALLY unfixed
-- (auth.uid() without SELECT wrapping it)
SELECT
  tablename,
  policyname,
  cmd,
  qual as using_clause,
  with_check as with_check_clause,

  -- Check if qual has unwrapped auth.uid()
  CASE
    WHEN qual ~ 'auth\.uid\(\)' AND qual !~* 'SELECT.*auth\.uid\(\)' THEN 'UNFIXED'
    ELSE 'FIXED or N/A'
  END as using_status,

  -- Check if with_check has unwrapped auth.uid()
  CASE
    WHEN with_check ~ 'auth\.uid\(\)' AND with_check !~* 'SELECT.*auth\.uid\(\)' THEN 'UNFIXED'
    ELSE 'FIXED or N/A'
  END as with_check_status

FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'athlete_badges'
ORDER BY policyname;

-- ============================================================================

-- Count truly unfixed policies (case-insensitive, handles normalization)
SELECT COUNT(*) as truly_unfixed_policies
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

-- ============================================================================
-- EXPLANATION:
-- ============================================================================
-- ~ is regex match (case-sensitive for function names)
-- !~* is NOT regex match (case-insensitive for SELECT keyword)
--
-- Pattern: auth\.uid\(\) matches "auth.uid()"
-- Pattern: SELECT.*auth\.uid\(\) matches "SELECT ... auth.uid()"
--
-- So we're looking for:
-- - Has auth.uid() somewhere
-- - Does NOT have SELECT before auth.uid()
-- - This catches unwrapped calls
-- ============================================================================
