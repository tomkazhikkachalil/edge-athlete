-- ============================================================================
-- VALIDATE REALTIME SETUP
-- ============================================================================
-- Run this SQL to verify real-time features are properly configured
-- ============================================================================

-- Check 1: Verify notifications table exists
SELECT 'Notifications table' as check_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications')
    THEN '✅ EXISTS'
    ELSE '❌ MISSING - Run enable-realtime-features.sql'
  END as status;

-- Check 2: Verify realtime is enabled for posts
SELECT 'Posts realtime' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'posts'
    )
    THEN '✅ ENABLED'
    ELSE '❌ DISABLED - Run enable-realtime-features.sql'
  END as status;

-- Check 3: Verify realtime is enabled for notifications
SELECT 'Notifications realtime' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
    )
    THEN '✅ ENABLED'
    ELSE '❌ DISABLED - Run enable-realtime-features.sql'
  END as status;

-- Check 4: Verify replica identity is set for posts
SELECT 'Posts replica identity' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_class
      WHERE relname = 'posts' AND relreplident = 'f'
    )
    THEN '✅ FULL'
    ELSE '❌ NOT SET - Run enable-realtime-features.sql'
  END as status;

-- Check 5: Verify replica identity is set for notifications
SELECT 'Notifications replica identity' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_class
      WHERE relname = 'notifications' AND relreplident = 'f'
    )
    THEN '✅ FULL'
    ELSE '❌ NOT SET - Run enable-realtime-features.sql'
  END as status;

-- Check 6: Verify RLS is enabled on notifications
SELECT 'Notifications RLS' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_tables
      WHERE tablename = 'notifications' AND rowsecurity = true
    )
    THEN '✅ ENABLED'
    ELSE '❌ DISABLED - Run enable-realtime-features.sql'
  END as status;

-- Check 7: Count RLS policies on notifications
SELECT 'Notifications RLS policies' as check_name,
  COALESCE(COUNT(*)::text, '0') || ' policies' as status
FROM pg_policies
WHERE tablename = 'notifications';

-- Check 8: Verify indexes on notifications
SELECT 'Notifications indexes' as check_name,
  COALESCE(COUNT(*)::text, '0') || ' indexes' as status
FROM pg_indexes
WHERE tablename = 'notifications';

-- Check 9: Verify triggers exist
SELECT 'Database triggers' as check_name,
  COALESCE(COUNT(*)::text, '0') || ' triggers' as status
FROM pg_trigger
WHERE tgname LIKE '%notification%';

-- Check 10: List all realtime-enabled tables
SELECT '=== REALTIME ENABLED TABLES ===' as info;

SELECT
  tablename,
  schemaname
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- Check 11: Summary
SELECT '=== SETUP SUMMARY ===' as info;

SELECT
  'Total checks' as metric,
  '9 required' as value;

SELECT
  'Expected result' as metric,
  'All checks should show ✅' as value;

SELECT
  'If any check shows ❌' as metric,
  'Run enable-realtime-features.sql in Supabase SQL Editor' as value;

-- ============================================================================
-- EXPECTED OUTPUT
-- ============================================================================
-- All checks should show ✅ ENABLED or ✅ EXISTS
-- If any show ❌, run the enable-realtime-features.sql file
-- ============================================================================
