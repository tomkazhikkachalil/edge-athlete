-- CREATE TEST USERS FOR SEARCH FUNCTIONALITY TESTING
-- This creates sample athlete profiles to test search, discovery, and social features

-- =====================================================
-- TEST ATHLETE PROFILES
-- =====================================================

-- Note: These are profiles without auth.users entries
-- They're searchable but not loginable (for demo/testing only)

INSERT INTO profiles (id, email, full_name, first_name, last_name, username, sport, position, school, team, location, bio, avatar_url)
VALUES
  -- Basketball Player
  (
    '00000000-0000-0000-0000-000000000001',
    'michael.jordan@test.com',
    'Michael Jordan',
    'Michael',
    'Jordan',
    'mj23',
    'Basketball',
    'Shooting Guard',
    'North Carolina',
    'Tar Heels',
    'Chapel Hill, NC',
    'Aspiring basketball player. Working on my jump shot every day. 🏀',
    NULL
  ),

  -- Soccer Player
  (
    '00000000-0000-0000-0000-000000000002',
    'alex.morgan@test.com',
    'Alex Morgan',
    'Alex',
    'Morgan',
    'amorgan13',
    'Soccer',
    'Forward',
    'UC Berkeley',
    'Golden Bears',
    'Berkeley, CA',
    'Soccer forward with a passion for the beautiful game. Team first! ⚽',
    NULL
  ),

  -- Track & Field Athlete
  (
    '00000000-0000-0000-0000-000000000003',
    'usain.bolt@test.com',
    'Usain Bolt',
    'Usain',
    'Bolt',
    'lightning_bolt',
    'Track & Field',
    'Sprinter',
    'University of Miami',
    'Hurricanes',
    'Miami, FL',
    '100m and 200m specialist. Chasing records and dreams. 🏃‍♂️⚡',
    NULL
  ),

  -- Volleyball Player
  (
    '00000000-0000-0000-0000-000000000004',
    'kerri.walsh@test.com',
    'Kerri Walsh Jennings',
    'Kerri',
    'Walsh Jennings',
    'kwj_volleyball',
    'Volleyball',
    'Outside Hitter',
    'Stanford University',
    'Cardinal',
    'Stanford, CA',
    'Beach and indoor volleyball player. Love the grind! 🏐',
    NULL
  ),

  -- Golf Player (to test golf-specific search)
  (
    '00000000-0000-0000-0000-000000000005',
    'tiger.woods@test.com',
    'Tiger Woods',
    'Tiger',
    'Woods',
    'tiger_golf',
    'Golf',
    'Professional',
    'Stanford University',
    'Cardinal Golf',
    'Palo Alto, CA',
    'Golf is my passion. Always working on my game. 🏌️‍♂️⛳',
    NULL
  )
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- UPDATE PROFILE FIELDS FOR BETTER SEARCH TESTING
-- =====================================================

-- Add some additional searchable data
UPDATE profiles SET
  height_cm = 198,
  weight_display = 215,
  weight_unit = 'lbs',
  class_year = 2025,
  social_instagram = '@mj23_hoops',
  social_twitter = '@MichaelJordan'
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE profiles SET
  height_cm = 170,
  weight_display = 130,
  weight_unit = 'lbs',
  class_year = 2024,
  social_instagram = '@alexmorgan13',
  social_twitter = '@alexmorgan13'
WHERE id = '00000000-0000-0000-0000-000000000002';

UPDATE profiles SET
  height_cm = 195,
  weight_display = 207,
  weight_unit = 'lbs',
  class_year = 2026,
  social_instagram = '@usainbolt',
  social_twitter = '@usainbolt'
WHERE id = '00000000-0000-0000-0000-000000000003';

UPDATE profiles SET
  height_cm = 188,
  weight_display = 150,
  weight_unit = 'lbs',
  class_year = 2024,
  social_instagram = '@kerrileewalsh',
  social_twitter = '@kerrileewalsh'
WHERE id = '00000000-0000-0000-0000-000000000004';

UPDATE profiles SET
  height_cm = 185,
  weight_display = 185,
  weight_unit = 'lbs',
  class_year = 2025,
  social_instagram = '@tigerwoods',
  social_twitter = '@TigerWoods',
  golf_handicap = 0.5,
  golf_home_course = 'Pebble Beach Golf Links'
WHERE id = '00000000-0000-0000-0000-000000000005';

-- =====================================================
-- CREATE SAMPLE POSTS FOR SEARCH TESTING
-- =====================================================

INSERT INTO posts (id, profile_id, sport_key, caption, visibility, hashtags, tags, likes_count, comments_count)
VALUES
  -- Basketball post
  (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000001',
    'basketball',
    'Great practice session today! Working on my three-point shot. 🏀',
    'public',
    ARRAY['basketball', 'training', 'ncaa'],
    ARRAY['practice', 'shooting'],
    0,
    0
  ),

  -- Soccer post
  (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000002',
    'soccer',
    'Team practice was intense! Ready for Saturday''s big game. ⚽💪',
    'public',
    ARRAY['soccer', 'gameday', 'teamwork'],
    ARRAY['training', 'ucberkeley'],
    0,
    0
  ),

  -- Track post
  (
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000003',
    'track_field',
    'New personal record in the 100m! 9.98 seconds! 🏃‍♂️⚡',
    'public',
    ARRAY['trackandfield', 'sprinting', 'PR'],
    ARRAY['100m', 'record'],
    0,
    0
  ),

  -- Golf post
  (
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000005',
    'golf',
    'Amazing round at Pebble Beach today. Shot a 68! 🏌️‍♂️⛳',
    'public',
    ARRAY['golf', 'pebblebeach', 'underpar'],
    ARRAY['round', 'course'],
    0,
    0
  )
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check that profiles were created
SELECT
  id,
  full_name,
  sport,
  school,
  email
FROM profiles
WHERE id::text LIKE '00000000-0000-0000-0000-0000000000%'
ORDER BY full_name;

-- Check that posts were created
SELECT
  p.id,
  pr.full_name as author,
  p.caption,
  p.hashtags
FROM posts p
JOIN profiles pr ON p.profile_id = pr.id
WHERE p.id::text LIKE '00000000-0000-0000-0000-0000000001%'
ORDER BY p.created_at DESC;

-- =====================================================
-- SEARCH TEST QUERIES
-- =====================================================

-- Test search by name
SELECT full_name, sport, school
FROM profiles
WHERE full_name ILIKE '%jordan%'
OR first_name ILIKE '%jordan%'
OR last_name ILIKE '%jordan%';

-- Test search by sport
SELECT full_name, sport, school
FROM profiles
WHERE sport ILIKE '%basketball%';

-- Test search by school
SELECT full_name, sport, school
FROM profiles
WHERE school ILIKE '%stanford%';

-- Test post search by hashtag
SELECT
  pr.full_name,
  p.caption,
  p.hashtags
FROM posts p
JOIN profiles pr ON p.profile_id = pr.id
WHERE p.visibility = 'public'
AND (
  p.caption ILIKE '%basketball%'
  OR 'basketball' = ANY(p.hashtags)
);

-- =====================================================
-- CLEANUP (if needed)
-- =====================================================

-- To remove test data later, uncomment and run:
-- DELETE FROM posts WHERE id::text LIKE '00000000-0000-0000-0000-0000000001%';
-- DELETE FROM profiles WHERE id::text LIKE '00000000-0000-0000-0000-0000000000%';

-- =====================================================
-- NOTES
-- =====================================================

-- These test users:
-- ✅ Are searchable via the search bar
-- ✅ Have realistic athlete data
-- ✅ Represent multiple sports
-- ✅ Have sample posts for testing
-- ❌ Cannot log in (no auth.users entries)
-- ❌ Are for testing/demo purposes only

-- To make them loginable, you would need to:
-- 1. Create entries in auth.users table
-- 2. Link profiles.id to auth.users.id
-- 3. Set passwords or enable magic link auth
