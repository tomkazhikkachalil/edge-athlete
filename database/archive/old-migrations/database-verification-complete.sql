-- COMPREHENSIVE DATABASE VERIFICATION SCRIPT
-- Run this in Supabase SQL Editor to verify all setup is correct

-- =====================================================
-- 1. VERIFY TABLES EXIST
-- =====================================================

SELECT 'CHECKING TABLES...' as status;

SELECT 
  table_name,
  table_type
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND (table_name LIKE '%athlete%' OR table_name = 'profiles')
ORDER BY table_name;

-- =====================================================
-- 2. VERIFY PROFILES TABLE EXTENSIONS
-- =====================================================

SELECT 'CHECKING PROFILES TABLE COLUMNS...' as status;

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
  AND column_name IN (
    'display_name', 'sport', 'school', 'location', 'coach', 
    'bio', 'graduation_year', 'gpa', 'sat_score', 'act_score', 'avatar_url'
  )
ORDER BY column_name;

-- =====================================================
-- 3. VERIFY ATHLETE TABLES STRUCTURE
-- =====================================================

SELECT 'CHECKING ATHLETE_BADGES TABLE...' as status;
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'athlete_badges'
ORDER BY ordinal_position;

SELECT 'CHECKING ATHLETE_VITALS TABLE...' as status;
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'athlete_vitals'
ORDER BY ordinal_position;

SELECT 'CHECKING ATHLETE_SOCIALS TABLE...' as status;
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'athlete_socials'
ORDER BY ordinal_position;

SELECT 'CHECKING ATHLETE_PERFORMANCES TABLE...' as status;
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'athlete_performances'
ORDER BY ordinal_position;

SELECT 'CHECKING ATHLETE_SEASON_HIGHLIGHTS TABLE...' as status;
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'athlete_season_highlights'
ORDER BY ordinal_position;

-- =====================================================
-- 4. VERIFY RLS IS ENABLED
-- =====================================================

SELECT 'CHECKING RLS STATUS...' as status;

SELECT 
  schemaname, 
  tablename, 
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND (tablename LIKE '%athlete%' OR tablename = 'profiles')
ORDER BY tablename;

-- =====================================================
-- 5. VERIFY RLS POLICIES
-- =====================================================

SELECT 'CHECKING RLS POLICIES...' as status;

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
  AND tablename LIKE '%athlete%'
ORDER BY tablename, policyname;

-- =====================================================
-- 6. VERIFY INDEXES
-- =====================================================

SELECT 'CHECKING INDEXES...' as status;

SELECT 
  t.relname as table_name,
  i.relname as index_name,
  pg_get_indexdef(i.oid) as index_definition
FROM pg_class t, pg_class i, pg_index ix
WHERE t.oid = ix.indrelid 
  AND i.oid = ix.indexrelid
  AND t.relkind = 'r'
  AND t.relname LIKE '%athlete%'
ORDER BY t.relname, i.relname;

-- =====================================================
-- 7. VERIFY STORAGE BUCKETS
-- =====================================================

SELECT 'CHECKING STORAGE BUCKETS...' as status;

SELECT 
  id,
  name,
  public,
  created_at
FROM storage.buckets 
WHERE id IN ('uploads', 'avatars')
ORDER BY id;

-- =====================================================
-- 8. VERIFY STORAGE POLICIES  
-- =====================================================

SELECT 'CHECKING STORAGE POLICIES...' as status;

SELECT 
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%upload%'
ORDER BY policyname;

-- =====================================================
-- 9. VERIFY TRIGGERS
-- =====================================================

SELECT 'CHECKING TRIGGERS...' as status;

SELECT 
  trigger_schema,
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers 
WHERE trigger_schema = 'public' 
  AND event_object_table LIKE '%athlete%'
ORDER BY event_object_table, trigger_name;

-- =====================================================
-- 10. TEST DATA INSERTION AND RETRIEVAL
-- =====================================================

-- This section will test basic CRUD operations
-- Note: This requires a valid user_id from auth.users

SELECT 'TESTING DATA OPERATIONS...' as status;

-- Get a test user (if exists)
DO $$
DECLARE 
  test_user_id TEXT;
BEGIN
  -- Try to get an existing user for testing
  SELECT id INTO test_user_id FROM profiles LIMIT 1;
  
  IF test_user_id IS NOT NULL THEN
    RAISE NOTICE 'Found test user: %', test_user_id;
    
    -- Test athlete_badges insertion
    INSERT INTO athlete_badges (user_id, badge_type, display_order)
    VALUES (test_user_id, 'test_badge', 1)
    ON CONFLICT DO NOTHING;
    
    -- Test athlete_season_highlights insertion
    INSERT INTO athlete_season_highlights (user_id, stat_name, stat_value, stat_context, display_order)
    VALUES (test_user_id, 'Test Stat', '100', 'Test Context', 1)
    ON CONFLICT DO NOTHING;
    
    -- Verify data was inserted
    RAISE NOTICE 'Badge count for user: %', (
      SELECT COUNT(*) FROM athlete_badges WHERE user_id = test_user_id
    );
    
    RAISE NOTICE 'Highlights count for user: %', (
      SELECT COUNT(*) FROM athlete_season_highlights WHERE user_id = test_user_id
    );
    
  ELSE
    RAISE NOTICE 'No test user found. Create a user first to test data operations.';
  END IF;
END $$;

-- =====================================================
-- 11. FINAL VERIFICATION SUMMARY
-- =====================================================

SELECT 'VERIFICATION SUMMARY' as status;

-- Count all athlete tables
WITH table_counts AS (
  SELECT 
    'profiles' as table_name,
    COUNT(*) as record_count
  FROM profiles
  
  UNION ALL
  
  SELECT 
    'athlete_badges' as table_name,
    COUNT(*) as record_count
  FROM athlete_badges
  
  UNION ALL
  
  SELECT 
    'athlete_vitals' as table_name,
    COUNT(*) as record_count
  FROM athlete_vitals
  
  UNION ALL
  
  SELECT 
    'athlete_socials' as table_name,
    COUNT(*) as record_count
  FROM athlete_socials
  
  UNION ALL
  
  SELECT 
    'athlete_performances' as table_name,
    COUNT(*) as record_count
  FROM athlete_performances
  
  UNION ALL
  
  SELECT 
    'athlete_season_highlights' as table_name,
    COUNT(*) as record_count
  FROM athlete_season_highlights
)
SELECT * FROM table_counts ORDER BY table_name;

-- Check if essential columns exist in profiles
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'profiles' 
        AND column_name IN ('display_name', 'sport', 'school', 'avatar_url')
      HAVING COUNT(*) >= 4
    ) THEN '✅ Profiles table extended correctly'
    ELSE '❌ Profiles table missing required columns'
  END as profiles_status;

-- Check if all athlete tables exist
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_badges')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_vitals')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_socials')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_performances')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_season_highlights')
    THEN '✅ All athlete tables exist'
    ELSE '❌ Some athlete tables missing'
  END as tables_status;

-- Check RLS status
SELECT 
  CASE 
    WHEN (
      SELECT COUNT(*) FROM pg_tables 
      WHERE schemaname = 'public' 
        AND tablename LIKE '%athlete%' 
        AND rowsecurity = true
    ) >= 5 
    THEN '✅ RLS enabled on all athlete tables'
    ELSE '❌ RLS not enabled on some tables'
  END as rls_status;

-- Check storage bucket
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'uploads')
    THEN '✅ Storage bucket exists'
    ELSE '❌ Storage bucket missing'
  END as storage_status;

-- Final success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '==============================================';
  RAISE NOTICE '🔍 DATABASE VERIFICATION COMPLETE';
  RAISE NOTICE '==============================================';
  RAISE NOTICE '';
  RAISE NOTICE 'If all status checks show ✅, your database is ready!';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Test the athlete page at /athlete';
  RAISE NOTICE '2. Try creating and editing athlete profiles';
  RAISE NOTICE '3. Upload avatar images';
  RAISE NOTICE '4. Add performance data';
  RAISE NOTICE '';
  RAISE NOTICE 'Happy coding! 🚀';
END $$;