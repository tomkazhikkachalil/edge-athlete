-- ============================================
-- FIX ALL FUNCTION OVERLOADS - SEARCH PATH
-- ============================================
-- Purpose: Fix ALL function overloads, not just specific signatures
-- This script handles functions that have multiple versions with different parameters
-- Version: 3.0 (Comprehensive - handles all overloads)
-- Created: 2025-01-15
-- ============================================

-- ============================================
-- SECTION 1: IDENTIFY ALL FUNCTIONS NEEDING FIXES
-- ============================================

DO $$
DECLARE
  func_record RECORD;
  fixed_count INTEGER := 0;
  skipped_count INTEGER := 0;
  func_signature TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    FIXING ALL FUNCTION OVERLOADS';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';

  -- Loop through ALL public functions without search_path
  FOR func_record IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      p.oid AS function_oid,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.prosecdef = false
    AND (
      p.proconfig IS NULL OR
      NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS config
        WHERE config LIKE 'search_path=%'
      )
    )
    ORDER BY p.proname, p.oid
  LOOP
    -- Build ALTER FUNCTION command with full signature
    func_signature := func_record.schema_name || '.' || func_record.function_name || '(' || func_record.args || ')';

    BEGIN
      -- Execute ALTER FUNCTION with full signature
      EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', func_signature);
      fixed_count := fixed_count + 1;
      RAISE NOTICE '✓ Fixed: % (%)', func_record.function_name, func_record.args;
    EXCEPTION WHEN OTHERS THEN
      skipped_count := skipped_count + 1;
      RAISE NOTICE '⊘ Error fixing: % (%) - %', func_record.function_name, func_record.args, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    SUMMARY';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions fixed: %', fixed_count;
  RAISE NOTICE 'Functions skipped/errored: %', skipped_count;
  RAISE NOTICE '';
END $$;

-- ============================================
-- SECTION 2: VERIFICATION
-- ============================================

DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  -- Count remaining functions without search_path
  SELECT COUNT(*)
  INTO remaining_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.prosecdef = false
  AND (
    p.proconfig IS NULL OR
    NOT EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS config
      WHERE config LIKE 'search_path=%'
    )
  );

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions still without search_path: %', remaining_count;
  RAISE NOTICE '';

  IF remaining_count = 0 THEN
    RAISE NOTICE '✓ SUCCESS: All functions protected!';
    RAISE NOTICE '✓ Supabase Advisor should show 0 warnings';
  ELSE
    RAISE NOTICE '⚠ WARNING: % functions still need fixing', remaining_count;
    RAISE NOTICE '  (See list below)';
  END IF;
  RAISE NOTICE '';
END $$;

-- Show remaining functions (if any)
SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.oid AS function_oid
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.prosecdef = false
AND (
  p.proconfig IS NULL OR
  NOT EXISTS (
    SELECT 1 FROM unnest(p.proconfig) AS config
    WHERE config LIKE 'search_path=%'
  )
)
ORDER BY p.proname, p.oid;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT '✓ All function overloads processed!' AS status;
SELECT '✓ Refresh Supabase Advisor to verify' AS next_step;
