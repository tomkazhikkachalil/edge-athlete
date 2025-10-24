-- =====================================================
-- CREATE TEST PROFILES FOR TAGGING
-- =====================================================
-- This creates sample user profiles so you can test the tagging feature
-- Run this in Supabase SQL Editor if you're getting "No people found"

-- First, check if we have any profiles
DO $$
DECLARE
  profile_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO profile_count FROM profiles;
  RAISE NOTICE 'Current profile count: %', profile_count;
END $$;

-- Create test profiles
-- Note: These use random UUIDs. In production, these would link to auth.users
INSERT INTO profiles (
  id,
  email,
  full_name,
  first_name,
  last_name,
  sport,
  school,
  location,
  visibility,
  created_at
)
VALUES
  (
    gen_random_uuid(),
    'john.doe.test@example.com',
    'johndoe',
    'John',
    'Doe',
    'golf',
    'Harvard University',
    'Boston, MA',
    'public',
    NOW()
  ),
  (
    gen_random_uuid(),
    'jane.smith.test@example.com',
    'janesmith',
    'Jane',
    'Smith',
    'ice_hockey',
    'MIT',
    'Cambridge, MA',
    'public',
    NOW()
  ),
  (
    gen_random_uuid(),
    'mike.johnson.test@example.com',
    'mikejohnson',
    'Mike',
    'Johnson',
    'volleyball',
    'Stanford University',
    'Stanford, CA',
    'public',
    NOW()
  ),
  (
    gen_random_uuid(),
    'sarah.williams.test@example.com',
    'sarahwilliams',
    'Sarah',
    'Williams',
    'golf',
    'Duke University',
    'Durham, NC',
    'public',
    NOW()
  ),
  (
    gen_random_uuid(),
    'tom.brown.test@example.com',
    'tombrown',
    'Tom',
    'Brown',
    'ice_hockey',
    'Boston College',
    'Boston, MA',
    'public',
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- Update search vectors if the column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles'
    AND column_name = 'search_vector'
  ) THEN
    UPDATE profiles
    SET email = email
    WHERE search_vector IS NULL OR search_vector IS NOT NULL;
    RAISE NOTICE 'Search vectors updated';
  ELSE
    RAISE NOTICE 'search_vector column does not exist - search will use ILIKE fallback';
  END IF;
END $$;

-- Verify profiles were created
SELECT
  id,
  full_name,
  first_name,
  last_name,
  email,
  sport,
  school,
  visibility
FROM profiles
WHERE email LIKE '%test@example.com'
ORDER BY created_at DESC
LIMIT 10;

-- Show total count
SELECT COUNT(*) as total_profiles FROM profiles;
