-- =====================================================
-- DIAGNOSE FOLLOW BUTTON ERROR (FIXED)
-- =====================================================
-- Purpose: Find out why follow is still failing
-- Run these queries one by one and share the results
-- =====================================================

-- =====================================================
-- QUERY 1: Check if triggers exist and are enabled
-- =====================================================

SELECT
  t.tgname as trigger_name,
  c.relname as table_name,
  CASE t.tgenabled
    WHEN 'O' THEN 'ENABLED'
    WHEN 'D' THEN 'DISABLED'
    ELSE t.tgenabled::text
  END as status,
  p.proname as function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'follows'
AND t.tgname LIKE '%notify%'
ORDER BY t.tgname;

-- =====================================================
-- QUERY 2: Check notification function search_path (FIXED)
-- =====================================================

SELECT
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  CASE
    WHEN p.proconfig IS NULL THEN 'NO SEARCH PATH SET'
    WHEN EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS cfg
      WHERE cfg::text LIKE 'search_path%'
    ) THEN (
      SELECT cfg::text FROM unnest(p.proconfig) AS cfg
      WHERE cfg::text LIKE 'search_path%'
      LIMIT 1
    )
    ELSE 'NO SEARCH PATH SET'
  END as search_path_setting
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.proname IN ('notify_follow_request', 'notify_follow_accepted', 'create_notification')
ORDER BY p.proname;

-- =====================================================
-- QUERY 3: Check RLS policies on follows table
-- =====================================================

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'follows'
ORDER BY policyname;

-- =====================================================
-- QUERY 4: Check notifications and preferences tables
-- =====================================================

SELECT
  'notifications' as table_name,
  EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'notifications'
  ) as exists
UNION ALL
SELECT
  'notification_preferences' as table_name,
  EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'notification_preferences'
  ) as exists;

-- =====================================================
-- QUERY 5: Test notification function manually
-- =====================================================

DO $$
DECLARE
  test_follower_id UUID;
  test_following_id UUID;
  result UUID;
BEGIN
  -- Get two real user IDs
  SELECT id INTO test_follower_id FROM public.profiles LIMIT 1 OFFSET 0;
  SELECT id INTO test_following_id FROM public.profiles WHERE id != test_follower_id LIMIT 1;

  IF test_follower_id IS NULL OR test_following_id IS NULL THEN
    RAISE NOTICE '✗ Not enough users in database to test';
    RETURN;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════';
  RAISE NOTICE 'Testing notification function...';
  RAISE NOTICE '══════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Follower ID: %', test_follower_id;
  RAISE NOTICE 'Following ID: %', test_following_id;
  RAISE NOTICE '';

  -- Try to call the notification function
  BEGIN
    SELECT public.create_notification(
      p_user_id := test_following_id,
      p_type := 'follow_request',
      p_actor_id := test_follower_id,
      p_title := 'Test notification',
      p_message := 'Testing notification system',
      p_action_url := '/test'
    ) INTO result;

    IF result IS NULL THEN
      RAISE NOTICE '✓ Function executed but returned NULL (might be disabled in preferences)';
    ELSE
      RAISE NOTICE '✓ Notification created successfully! ID: %', result;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '';
    RAISE NOTICE '✗ ✗ ✗ NOTIFICATION FUNCTION FAILED ✗ ✗ ✗';
    RAISE NOTICE '';
    RAISE NOTICE 'Error Code: %', SQLSTATE;
    RAISE NOTICE 'Error Message: %', SQLERRM;
    RAISE NOTICE '';
    RAISE NOTICE 'This is likely the error breaking the follow button!';
    RAISE NOTICE '';
  END;
END $$;

-- =====================================================
-- QUERY 6: Check actual function definition
-- =====================================================

SELECT
  'notify_follow_request' as function_name,
  pg_get_functiondef(oid) as definition
FROM pg_proc
WHERE proname = 'notify_follow_request'
AND pronamespace = 'public'::regnamespace;

-- =====================================================
-- QUERY 7: Simple follow insert test (bypassing triggers)
-- =====================================================

DO $$
DECLARE
  test_follower_id UUID;
  test_following_id UUID;
BEGIN
  -- Get two real user IDs
  SELECT id INTO test_follower_id FROM public.profiles LIMIT 1 OFFSET 0;
  SELECT id INTO test_following_id FROM public.profiles WHERE id != test_follower_id LIMIT 1;

  IF test_follower_id IS NULL OR test_following_id IS NULL THEN
    RAISE NOTICE '✗ Not enough users to test';
    RETURN;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════';
  RAISE NOTICE 'Testing direct insert to follows...';
  RAISE NOTICE '══════════════════════════════════════';
  RAISE NOTICE '';

  -- First, clean up any existing test follow
  DELETE FROM public.follows
  WHERE follower_id = test_follower_id
  AND following_id = test_following_id;

  -- Try to insert (this will trigger the notification)
  BEGIN
    INSERT INTO public.follows (follower_id, following_id, status)
    VALUES (test_follower_id, test_following_id, 'pending');

    RAISE NOTICE '✓ Insert successful! Trigger must have worked.';

    -- Clean up
    DELETE FROM public.follows
    WHERE follower_id = test_follower_id
    AND following_id = test_following_id;

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '';
    RAISE NOTICE '✗ ✗ ✗ INSERT FAILED ✗ ✗ ✗';
    RAISE NOTICE '';
    RAISE NOTICE 'Error Code: %', SQLSTATE;
    RAISE NOTICE 'Error Message: %', SQLERRM;
    RAISE NOTICE '';
    RAISE NOTICE 'THIS IS THE ERROR BREAKING THE FOLLOW BUTTON!';
    RAISE NOTICE '';
  END;
END $$;
