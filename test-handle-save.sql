-- =====================================================
-- TEST HANDLE SAVE FUNCTIONALITY
-- =====================================================
-- This script tests if handles are being saved correctly

-- Test 1: Check if handle column exists and is configured correctly
SELECT
  'Test 1: Column Configuration' as test_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name = 'handle';

-- Test 2: Check unique constraint
SELECT
  'Test 2: Unique Index' as test_name,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'profiles'
  AND indexname LIKE '%handle%';

-- Test 3: Try to manually insert a test handle (will rollback)
DO $$
DECLARE
  test_profile_id UUID;
BEGIN
  -- Find a profile without a handle
  SELECT id INTO test_profile_id
  FROM profiles
  WHERE handle IS NULL
  LIMIT 1;

  IF test_profile_id IS NOT NULL THEN
    -- Try to update with a test handle
    UPDATE profiles
    SET handle = 'test_handle_' || substring(test_profile_id::text from 1 for 8)
    WHERE id = test_profile_id;

    RAISE NOTICE 'Test handle saved successfully for profile: %', test_profile_id;

    -- Rollback the change
    ROLLBACK;
  ELSE
    RAISE NOTICE 'All profiles already have handles';
  END IF;
END $$;

-- Test 4: Check RLS policies for handle updates
SELECT
  'Test 4: RLS Policies' as test_name,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'profiles'
  AND (qual LIKE '%handle%' OR with_check LIKE '%handle%' OR policyname LIKE '%handle%');

-- Test 5: Sample current handles
SELECT
  'Test 5: Sample Handles' as test_name,
  id,
  COALESCE(first_name, 'N/A') as first_name,
  COALESCE(last_name, 'N/A') as last_name,
  COALESCE(handle, 'NO HANDLE') as handle,
  handle_updated_at,
  created_at
FROM profiles
ORDER BY created_at DESC
LIMIT 10;

-- Test 6: Count profiles with and without handles
SELECT
  'Test 6: Handle Statistics' as test_name,
  COUNT(*) as total_profiles,
  COUNT(handle) as profiles_with_handle,
  COUNT(*) - COUNT(handle) as profiles_without_handle,
  ROUND(COUNT(handle)::numeric / NULLIF(COUNT(*), 0) * 100, 2) as handle_coverage_percent
FROM profiles;
