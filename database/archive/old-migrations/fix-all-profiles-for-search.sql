-- =====================================================
-- FIX ALL PROFILES FOR SEARCH (Quick Fix)
-- =====================================================
-- Makes all 3 profiles public and searchable
-- Run this in Supabase SQL Editor

-- Step 1: Make ALL profiles public
UPDATE profiles SET visibility = 'public';

-- Step 2: Fill in any missing names
UPDATE profiles
SET
  first_name = COALESCE(
    first_name,
    'User' || SUBSTRING(id::text FROM 1 FOR 4)  -- e.g., "User-abc1"
  ),
  last_name = COALESCE(
    last_name,
    SUBSTRING(email FROM 1 FOR POSITION('@' IN email) - 1)  -- Use email prefix as last name
  ),
  full_name = COALESCE(full_name, email),
  sport = COALESCE(sport, 'golf'),
  school = COALESCE(school, 'Test University')
WHERE
  first_name IS NULL
  OR last_name IS NULL
  OR full_name IS NULL;

-- Step 3: Update search vectors
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles'
    AND column_name = 'search_vector'
  ) THEN
    UPDATE profiles SET email = email;
    RAISE NOTICE 'Search vectors updated';
  END IF;
END $$;

-- Step 4: Show what you can now search for
SELECT
  '>>> SEARCH FOR THESE NAMES <<<' as instruction;

SELECT
  ROW_NUMBER() OVER (ORDER BY first_name) as "#",
  first_name as "First Name",
  last_name as "Last Name",
  CONCAT(first_name, ' ', last_name) as "Full Name to Search",
  sport as "Sport",
  school as "School",
  email as "Email"
FROM profiles
WHERE visibility = 'public'
ORDER BY first_name;

-- Step 5: Summary
SELECT
  COUNT(*) as total_profiles,
  COUNT(CASE WHEN visibility = 'public' THEN 1 END) as public_profiles,
  COUNT(CASE WHEN first_name IS NOT NULL AND last_name IS NOT NULL THEN 1 END) as searchable_profiles,
  COUNT(CASE WHEN visibility = 'public' AND first_name IS NOT NULL AND last_name IS NOT NULL THEN 1 END) as ready_for_search
FROM profiles;
