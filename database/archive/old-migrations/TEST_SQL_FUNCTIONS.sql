-- =====================================================
-- TEST SQL FUNCTIONS - Profile Media Tabs
-- =====================================================
-- Use this to verify the SQL functions are working
-- =====================================================

-- =====================================================
-- STEP 1: FIND YOUR USER UUID
-- =====================================================

-- Get your user UUID from auth.users (if you know your email)
SELECT
  id as user_uuid,
  email,
  created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- OR get from profiles table
SELECT
  id as user_uuid,
  first_name,
  last_name,
  full_name,
  email
FROM profiles
ORDER BY created_at DESC
LIMIT 5;

-- =====================================================
-- STEP 2: CHECK IF FUNCTIONS EXIST
-- =====================================================

-- Should return 4 functions
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE 'get_profile%'
ORDER BY routine_name;

-- Expected output:
-- get_profile_all_media      | FUNCTION
-- get_profile_media_counts   | FUNCTION
-- get_profile_stats_media    | FUNCTION
-- get_profile_tagged_media   | FUNCTION

-- =====================================================
-- STEP 3: CHECK YOUR POSTS
-- =====================================================

-- View your posts (replace with your UUID)
-- EXAMPLE: WHERE profile_id = '12345678-1234-1234-1234-123456789abc'
SELECT
  id,
  caption,
  tags,
  created_at,
  visibility
FROM posts
WHERE profile_id = 'YOUR_UUID_HERE'  -- ← REPLACE THIS
ORDER BY created_at DESC
LIMIT 10;

-- =====================================================
-- STEP 4: TEST get_profile_all_media FUNCTION
-- =====================================================

-- Replace BOTH instances of YOUR_UUID_HERE with your actual UUID
SELECT * FROM get_profile_all_media(
  'YOUR_UUID_HERE'::uuid,  -- ← REPLACE: target profile
  'YOUR_UUID_HERE'::uuid,  -- ← REPLACE: viewer (same as target to see your own posts)
  10,                      -- limit
  0                        -- offset
);

-- =====================================================
-- STEP 5: TEST get_profile_media_counts FUNCTION
-- =====================================================

-- Replace BOTH instances of YOUR_UUID_HERE
SELECT * FROM get_profile_media_counts(
  'YOUR_UUID_HERE'::uuid,  -- ← REPLACE: target profile
  'YOUR_UUID_HERE'::uuid   -- ← REPLACE: viewer
);

-- Should return something like:
-- all_media_count: 5
-- stats_media_count: 2
-- tagged_media_count: 1

-- =====================================================
-- STEP 6: TEST get_profile_tagged_media FUNCTION
-- =====================================================

-- Replace YOUR_UUID_HERE
SELECT * FROM get_profile_tagged_media(
  'YOUR_UUID_HERE'::uuid,  -- ← REPLACE: target profile
  'YOUR_UUID_HERE'::uuid,  -- ← REPLACE: viewer
  10,
  0
);

-- =====================================================
-- STEP 7: CHECK SPORT COLUMNS EXIST
-- =====================================================

-- Should return 3 columns: game_id, match_id, race_id
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'posts'
AND column_name IN ('game_id', 'match_id', 'race_id')
ORDER BY column_name;

-- =====================================================
-- STEP 8: VIEW POSTS WITH TAGS
-- =====================================================

-- See all posts that have tags (for debugging)
SELECT
  id,
  caption,
  tags,
  profile_id,
  created_at
FROM posts
WHERE tags IS NOT NULL
AND array_length(tags, 1) > 0
ORDER BY created_at DESC
LIMIT 10;

-- =====================================================
-- QUICK DIAGNOSTIC
-- =====================================================

-- Run this entire block after replacing YOUR_UUID_HERE

DO $$
DECLARE
  user_uuid TEXT := 'YOUR_UUID_HERE';  -- ← REPLACE THIS
  post_count INT;
  function_count INT;
  column_count INT;
BEGIN
  -- Count user's posts
  EXECUTE format('SELECT COUNT(*) FROM posts WHERE profile_id = %L', user_uuid) INTO post_count;

  -- Count functions
  SELECT COUNT(*) INTO function_count
  FROM information_schema.routines
  WHERE routine_schema = 'public'
  AND routine_name LIKE 'get_profile%';

  -- Count sport columns
  SELECT COUNT(*) INTO column_count
  FROM information_schema.columns
  WHERE table_name = 'posts'
  AND column_name IN ('game_id', 'match_id', 'race_id');

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    DIAGNOSTIC REPORT';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'User UUID: %', user_uuid;
  RAISE NOTICE 'Posts by this user: %', post_count;
  RAISE NOTICE 'Profile functions found: % (should be 4)', function_count;
  RAISE NOTICE 'Sport columns found: % (should be 3)', column_count;
  RAISE NOTICE '';

  IF function_count < 4 THEN
    RAISE NOTICE '⚠ MISSING FUNCTIONS!';
    RAISE NOTICE 'Run: setup-profile-media-tabs.sql';
  ELSE
    RAISE NOTICE '✓ All functions exist';
  END IF;

  IF column_count < 3 THEN
    RAISE NOTICE '⚠ MISSING COLUMNS!';
    RAISE NOTICE 'Run: add-future-sport-columns.sql';
  ELSE
    RAISE NOTICE '✓ All sport columns exist';
  END IF;

  IF post_count = 0 THEN
    RAISE NOTICE '⚠ No posts found for this user';
  ELSE
    RAISE NOTICE '✓ User has posts';
  END IF;

  RAISE NOTICE '';
END $$;

-- =====================================================
-- HOW TO USE THIS FILE
-- =====================================================

/*
1. Run STEP 1 to find your user UUID
2. Copy your UUID (looks like: 12345678-1234-1234-1234-123456789abc)
3. Replace ALL instances of 'YOUR_UUID_HERE' in this file
4. Run each step to test

OR just run the QUICK DIAGNOSTIC at the bottom after replacing UUID
*/
