-- =====================================================
-- CREATE TEST PROFILES FOR TAGGING (FIXED)
-- =====================================================
-- This updates EXISTING user profiles so you can test tagging
-- Run this in Supabase SQL Editor

-- First, check current profile count
DO $$
DECLARE
  profile_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO profile_count FROM profiles;
  RAISE NOTICE 'Current profile count: %', profile_count;
END $$;

-- OPTION 1: Update existing profiles to have searchable data
-- This updates profiles that might have incomplete information
UPDATE profiles
SET
  first_name = COALESCE(first_name, 'Test'),
  last_name = COALESCE(last_name, 'User'),
  full_name = COALESCE(full_name, email),
  visibility = COALESCE(visibility, 'public'),
  sport = COALESCE(sport, 'golf'),
  school = COALESCE(school, 'Test University')
WHERE
  first_name IS NULL
  OR last_name IS NULL
  OR visibility IS NULL;

-- Update search vectors if the column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles'
    AND column_name = 'search_vector'
  ) THEN
    UPDATE profiles SET email = email;
    RAISE NOTICE 'Search vectors updated for all profiles';
  ELSE
    RAISE NOTICE 'search_vector column does not exist - search will use ILIKE fallback';
  END IF;
END $$;

-- Show all profiles with their searchable fields
SELECT
  id,
  email,
  full_name,
  first_name,
  last_name,
  sport,
  school,
  visibility,
  CASE
    WHEN first_name IS NOT NULL AND last_name IS NOT NULL THEN 'Searchable'
    ELSE 'Missing name data'
  END as search_status
FROM profiles
ORDER BY created_at DESC
LIMIT 20;

-- Show total count
SELECT
  COUNT(*) as total_profiles,
  COUNT(CASE WHEN first_name IS NOT NULL AND last_name IS NOT NULL THEN 1 END) as searchable_profiles,
  COUNT(CASE WHEN visibility = 'public' THEN 1 END) as public_profiles
FROM profiles;
