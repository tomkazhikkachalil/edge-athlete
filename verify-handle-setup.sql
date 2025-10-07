-- =====================================================
-- VERIFY HANDLE SYSTEM SETUP
-- =====================================================
-- Run this in Supabase SQL Editor to verify the handle system is set up

-- Check 1: Does the handle column exist?
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name IN ('handle', 'handle_updated_at', 'handle_change_count');

-- Check 2: Are there unique indexes?
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'profiles'
  AND indexname LIKE '%handle%';

-- Check 3: Do tables exist?
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('handle_history', 'reserved_handles');

-- Check 4: How many reserved handles?
SELECT COUNT(*) as reserved_count
FROM reserved_handles;

-- Check 5: How many users have handles?
SELECT
  COUNT(*) as total_users,
  COUNT(handle) as users_with_handle,
  COUNT(*) - COUNT(handle) as users_without_handle
FROM profiles;

-- Check 6: Sample of handles
SELECT
  id,
  first_name,
  last_name,
  handle,
  handle_updated_at
FROM profiles
WHERE handle IS NOT NULL
LIMIT 10;
