-- Quick database status check
-- Run this in Supabase SQL Editor to see what's working

-- Check if notifications table exists
SELECT 'notifications table exists' as status, EXISTS (
  SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications'
) as result;

-- Check if connection_suggestions table exists
SELECT 'connection_suggestions table exists' as status, EXISTS (
  SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'connection_suggestions'
) as result;

-- Check follows table columns
SELECT 'follows table columns' as status;
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'follows'
ORDER BY ordinal_position;

-- Check if status column exists specifically
SELECT 'status column exists' as status, EXISTS (
  SELECT FROM information_schema.columns
  WHERE table_name = 'follows' AND column_name = 'status'
) as result;

-- Check if message column exists specifically
SELECT 'message column exists' as status, EXISTS (
  SELECT FROM information_schema.columns
  WHERE table_name = 'follows' AND column_name = 'message'
) as result;

-- Check triggers
SELECT 'triggers' as status;
SELECT tgname as trigger_name
FROM pg_trigger
WHERE tgname LIKE 'trigger_notify%'
ORDER BY tgname;

-- Try to select from follows with status (will fail if column doesn't exist)
SELECT 'Test query follows table' as status;
SELECT id, follower_id, following_id, status, message, created_at
FROM follows
LIMIT 5;

-- Check RLS on follows table
SELECT 'RLS status on follows' as status, relname as table_name, relrowsecurity as rls_enabled
FROM pg_class
WHERE relname = 'follows';

-- Check RLS policies on follows
SELECT 'RLS policies on follows' as status;
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'follows';
