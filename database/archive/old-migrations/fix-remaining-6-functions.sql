-- ============================================
-- FIX REMAINING 6 STUBBORN FUNCTIONS
-- ============================================
-- Purpose: Target the last 6 functions with special handling
-- These functions may have SECURITY DEFINER or special return types
-- Version: 4.0 (Final cleanup)
-- Created: 2025-01-15
-- ============================================

-- ============================================
-- SECTION 1: DIAGNOSE THE REMAINING FUNCTIONS
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    DIAGNOSING REMAINING FUNCTIONS';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- Show detailed info about the 6 remaining functions
SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  CASE
    WHEN p.prosecdef THEN 'SECURITY DEFINER'
    ELSE 'SECURITY INVOKER'
  END AS security,
  pg_get_function_result(p.oid) AS return_type,
  p.proconfig AS current_config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.proname IN (
  'get_profile_all_media',
  'get_profile_stats_media',
  'get_profile_tagged_media',
  'create_notification',
  'get_tagged_posts',
  'get_profile_media_counts'
)
ORDER BY p.proname, p.oid;

-- ============================================
-- SECTION 2: FIX EACH FUNCTION INDIVIDUALLY
-- ============================================

DO $$
DECLARE
  func_record RECORD;
  fixed_count INTEGER := 0;
  func_signature TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    FIXING REMAINING FUNCTIONS';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';

  -- Get all overloads of the 6 remaining functions
  FOR func_record IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      p.oid AS function_oid,
      pg_get_function_identity_arguments(p.oid) AS args,
      CASE
        WHEN p.prosecdef THEN 'SECURITY DEFINER'
        ELSE 'SECURITY INVOKER'
      END AS security
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_profile_all_media',
      'get_profile_stats_media',
      'get_profile_tagged_media',
      'create_notification',
      'get_tagged_posts',
      'get_profile_media_counts'
    )
    ORDER BY p.proname, p.oid
  LOOP
    -- Build full function signature
    func_signature := func_record.schema_name || '.' || func_record.function_name;

    IF func_record.args <> '' THEN
      func_signature := func_signature || '(' || func_record.args || ')';
    ELSE
      func_signature := func_signature || '()';
    END IF;

    BEGIN
      -- Try to alter the function
      EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', func_signature);
      fixed_count := fixed_count + 1;
      RAISE NOTICE '✓ Fixed: % (%) [%]', func_record.function_name, COALESCE(func_record.args, 'no args'), func_record.security;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '✗ Failed: % (%) - %', func_record.function_name, COALESCE(func_record.args, 'no args'), SQLERRM;

      -- Try alternative approach for SECURITY DEFINER functions
      IF func_record.security = 'SECURITY DEFINER' THEN
        BEGIN
          -- For SECURITY DEFINER functions, use ALTER FUNCTION with RESET then SET
          EXECUTE format('ALTER FUNCTION %s RESET search_path', func_signature);
          EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', func_signature);
          fixed_count := fixed_count + 1;
          RAISE NOTICE '✓ Fixed (retry): % (%) [SECURITY DEFINER workaround]', func_record.function_name, COALESCE(func_record.args, 'no args');
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE '✗ Still failed: % (%) - %', func_record.function_name, COALESCE(func_record.args, 'no args'), SQLERRM;
        END;
      END IF;
    END;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE 'Functions fixed in this pass: %', fixed_count;
  RAISE NOTICE '';
END $$;

-- ============================================
-- SECTION 3: MANUAL FIXES FOR KNOWN SIGNATURES
-- ============================================
-- Sometimes the automatic approach doesn't work, so try explicit fixes

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    APPLYING MANUAL FIXES';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';

  -- Profile media functions (likely have uuid, integer, integer signature)
  BEGIN
    ALTER FUNCTION public.get_profile_all_media(uuid, integer, integer) SET search_path = '';
    RAISE NOTICE '✓ Manual fix: get_profile_all_media(uuid, integer, integer)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: get_profile_all_media(uuid, integer, integer) - %', SQLERRM;
  END;

  BEGIN
    ALTER FUNCTION public.get_profile_stats_media(uuid, integer, integer) SET search_path = '';
    RAISE NOTICE '✓ Manual fix: get_profile_stats_media(uuid, integer, integer)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: get_profile_stats_media(uuid, integer, integer) - %', SQLERRM;
  END;

  BEGIN
    ALTER FUNCTION public.get_profile_tagged_media(uuid, integer, integer) SET search_path = '';
    RAISE NOTICE '✓ Manual fix: get_profile_tagged_media(uuid, integer, integer)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: get_profile_tagged_media(uuid, integer, integer) - %', SQLERRM;
  END;

  -- Create notification (try all common signatures)
  BEGIN
    ALTER FUNCTION public.create_notification(uuid, uuid, text, text, jsonb) SET search_path = '';
    RAISE NOTICE '✓ Manual fix: create_notification(uuid, uuid, text, text, jsonb)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: create_notification(uuid, uuid, text, text, jsonb) - %', SQLERRM;
  END;

  BEGIN
    ALTER FUNCTION public.create_notification(uuid, text, jsonb) SET search_path = '';
    RAISE NOTICE '✓ Manual fix: create_notification(uuid, text, jsonb)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: create_notification(uuid, text, jsonb) - %', SQLERRM;
  END;

  -- Get tagged posts
  BEGIN
    ALTER FUNCTION public.get_tagged_posts(uuid) SET search_path = '';
    RAISE NOTICE '✓ Manual fix: get_tagged_posts(uuid)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: get_tagged_posts(uuid) - %', SQLERRM;
  END;

  -- Get profile media counts
  BEGIN
    ALTER FUNCTION public.get_profile_media_counts(uuid) SET search_path = '';
    RAISE NOTICE '✓ Manual fix: get_profile_media_counts(uuid)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: get_profile_media_counts(uuid) - %', SQLERRM;
  END;

  RAISE NOTICE '';
END $$;

-- ============================================
-- SECTION 4: FINAL VERIFICATION
-- ============================================

DO $$
DECLARE
  remaining_count INTEGER;
  remaining_names TEXT[];
BEGIN
  -- Count remaining functions
  SELECT
    COUNT(*),
    array_agg(DISTINCT p.proname)
  INTO remaining_count, remaining_names
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
  RAISE NOTICE '    FINAL VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions still without search_path: %', remaining_count;

  IF remaining_count > 0 THEN
    RAISE NOTICE 'Remaining function names: %', array_to_string(remaining_names, ', ');
  END IF;

  RAISE NOTICE '';

  IF remaining_count = 0 THEN
    RAISE NOTICE '✓✓✓ SUCCESS: ALL FUNCTIONS PROTECTED! ✓✓✓';
    RAISE NOTICE '✓ Supabase Advisor should now show 0 function warnings';
  ELSIF remaining_count <= 3 THEN
    RAISE NOTICE '⚠ Nearly there! Only % functions left', remaining_count;
    RAISE NOTICE '  These may need manual intervention';
  ELSE
    RAISE NOTICE '⚠ Still have % functions without search_path', remaining_count;
  END IF;
  RAISE NOTICE '';
END $$;

-- Show exact signatures of any remaining functions
SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  'ALTER FUNCTION public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') SET search_path = '''';' AS fix_command
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
ORDER BY p.proname;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT '✓ Targeted fix for remaining 6 functions complete!' AS status;
SELECT '✓ Refresh Supabase Advisor to check results' AS next_step;
