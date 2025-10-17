-- =====================================================
-- DIAGNOSE FOLLOW BUTTON ERROR
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
-- QUERY 2: Check notification function search_path
-- =====================================================

SELECT
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  COALESCE(
    (SELECT unnest(p.proconfig)
     WHERE unnest(p.proconfig) LIKE 'search_path%'),
    'NO SEARCH PATH SET'
  ) as search_path_setting
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
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'follows'
ORDER BY policyname;

-- =====================================================
-- QUERY 4: Test if you can insert into follows directly
-- =====================================================

-- First, get your user ID
SELECT
  id,
  email,
  first_name,
  last_name
FROM auth.users
JOIN profiles ON auth.users.id = profiles.id
LIMIT 1;

-- =====================================================
-- QUERY 5: Check notifications table structure
-- =====================================================

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'notifications'
ORDER BY ordinal_position;

-- =====================================================
-- QUERY 6: Try to manually trigger the notification function
-- =====================================================

-- This simulates what happens when you click follow
-- Replace the UUIDs with real user IDs from your database

DO $$
DECLARE
  test_follower_id UUID;
  test_following_id UUID;
BEGIN
  -- Get two real user IDs
  SELECT id INTO test_follower_id FROM profiles LIMIT 1 OFFSET 0;
  SELECT id INTO test_following_id FROM profiles LIMIT 1 OFFSET 1;

  RAISE NOTICE 'Testing with follower: %, following: %', test_follower_id, test_following_id;

  -- Try to call the notification function
  BEGIN
    PERFORM public.create_notification(
      p_user_id := test_following_id,
      p_type := 'follow_request',
      p_actor_id := test_follower_id,
      p_title := 'Test notification',
      p_message := 'Testing notification system',
      p_action_url := '/test'
    );
    RAISE NOTICE '✓ Notification function works!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✗ Notification function failed: %', SQLERRM;
  END;
END $$;

-- =====================================================
-- QUERY 7: Check if notification_preferences table exists
-- =====================================================

SELECT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'notification_preferences'
) as preferences_table_exists;
