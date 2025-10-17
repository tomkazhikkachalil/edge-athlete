-- ============================================================================
-- DIAGNOSTIC SCRIPT: Find actual column names used in RLS policies
-- ============================================================================
--
-- Purpose: Identify the correct column names for user references in each table
--          so we can fix the RLS optimization script with the right columns.
--
-- Run this to see what columns are ACTUALLY used in your policies.
-- ============================================================================

-- Check 1: Show actual policy definitions for affected tables
SELECT
  tablename,
  policyname,
  cmd,
  qual as policy_definition
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'saved_posts',
    'athlete_clubs',
    'post_comments',
    'sports',
    'season_highlights',
    'performances',
    'sport_settings',
    'connection_suggestions'
  )
  AND (qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%')
ORDER BY tablename, policyname;

-- Check 2: Show all columns for each affected table
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'saved_posts',
    'athlete_clubs',
    'post_comments',
    'sports',
    'season_highlights',
    'performances',
    'sport_settings',
    'connection_suggestions'
  )
  AND (
    column_name LIKE '%user%'
    OR column_name LIKE '%profile%'
    OR column_name LIKE '%id'
  )
ORDER BY table_name, column_name;

-- Check 3: Find foreign keys to profiles/users table
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN (
    'saved_posts',
    'athlete_clubs',
    'post_comments',
    'sports',
    'season_highlights',
    'performances',
    'sport_settings',
    'connection_suggestions'
  )
  AND (ccu.table_name = 'profiles' OR ccu.table_name LIKE '%user%')
ORDER BY tc.table_name;

-- Check 4: Show table structure summary
SELECT
  t.table_name,
  STRING_AGG(c.column_name, ', ' ORDER BY c.ordinal_position) as all_columns
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'saved_posts',
    'athlete_clubs',
    'post_comments',
    'sports',
    'season_highlights',
    'performances',
    'sport_settings',
    'connection_suggestions'
  )
GROUP BY t.table_name
ORDER BY t.table_name;

-- ============================================================================
-- INSTRUCTIONS:
-- ============================================================================
-- 1. Run this script in Supabase SQL Editor
-- 2. Review Check 1 to see the EXACT policy definitions
-- 3. Review Check 2 to see what columns actually exist
-- 4. Review Check 3 to see foreign key relationships
-- 5. Share the output so we can create the correct fix script
-- ============================================================================
