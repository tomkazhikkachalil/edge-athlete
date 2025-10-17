-- =====================================================
-- MIGRATE GOLF SETTINGS TO SPORT_SETTINGS TABLE
-- =====================================================
-- This migration extracts golf-specific columns from profiles
-- into a normalized sport_settings table with JSONB storage.
--
-- Benefits:
-- - Add new sports without schema changes
-- - Sport-agnostic profiles table
-- - Flexible settings per sport
-- - Backward compatible (golf data preserved)
--
-- Run this in Supabase SQL Editor
-- Safe to run multiple times (uses IF NOT EXISTS)
-- =====================================================

-- =====================================================
-- STEP 1: CREATE SPORT_SETTINGS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS sport_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sport_key TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- Ensure one settings record per profile per sport
  UNIQUE(profile_id, sport_key)
);

-- Add helpful comment
COMMENT ON TABLE sport_settings IS 'Sport-specific settings for athlete profiles. Each sport stores its own configuration in JSONB format.';

-- =====================================================
-- STEP 2: CREATE INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_sport_settings_profile
  ON sport_settings(profile_id);

CREATE INDEX IF NOT EXISTS idx_sport_settings_sport
  ON sport_settings(sport_key);

CREATE INDEX IF NOT EXISTS idx_sport_settings_composite
  ON sport_settings(profile_id, sport_key);

-- GIN index for JSONB queries (if you need to filter by specific settings)
CREATE INDEX IF NOT EXISTS idx_sport_settings_jsonb
  ON sport_settings USING GIN(settings);

-- =====================================================
-- STEP 3: ENABLE ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE sport_settings ENABLE ROW LEVEL SECURITY;

-- Users can view their own sport settings
DROP POLICY IF EXISTS "Users can view their own sport settings" ON sport_settings;
CREATE POLICY "Users can view their own sport settings"
  ON sport_settings FOR SELECT
  USING (auth.uid() = profile_id);

-- Users can insert their own sport settings
DROP POLICY IF EXISTS "Users can insert their own sport settings" ON sport_settings;
CREATE POLICY "Users can insert their own sport settings"
  ON sport_settings FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

-- Users can update their own sport settings
DROP POLICY IF EXISTS "Users can update their own sport settings" ON sport_settings;
CREATE POLICY "Users can update their own sport settings"
  ON sport_settings FOR UPDATE
  USING (auth.uid() = profile_id);

-- Users can delete their own sport settings
DROP POLICY IF EXISTS "Users can delete their own sport settings" ON sport_settings;
CREATE POLICY "Users can delete their own sport settings"
  ON sport_settings FOR DELETE
  USING (auth.uid() = profile_id);

-- =====================================================
-- STEP 4: CREATE UPDATED_AT TRIGGER
-- =====================================================

CREATE TRIGGER handle_updated_at_sport_settings
  BEFORE UPDATE ON sport_settings
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- =====================================================
-- STEP 5: MIGRATE EXISTING GOLF DATA
-- =====================================================

-- Insert golf settings for profiles that have golf data
-- Uses ON CONFLICT to avoid duplicates if run multiple times
INSERT INTO sport_settings (profile_id, sport_key, settings)
SELECT
  id,
  'golf',
  jsonb_strip_nulls(jsonb_build_object(
    'handicap', golf_handicap,
    'home_course', golf_home_course,
    'tee_preference', golf_tee_preference,
    'dominant_hand', golf_dominant_hand,
    'driver_brand', golf_driver_brand,
    'driver_loft', golf_driver_loft,
    'irons_brand', golf_irons_brand,
    'putter_brand', golf_putter_brand,
    'ball_brand', golf_ball_brand
  ))
FROM profiles
WHERE
  golf_handicap IS NOT NULL
  OR golf_home_course IS NOT NULL
  OR golf_tee_preference IS NOT NULL
  OR golf_dominant_hand IS NOT NULL
  OR golf_driver_brand IS NOT NULL
  OR golf_driver_loft IS NOT NULL
  OR golf_irons_brand IS NOT NULL
  OR golf_putter_brand IS NOT NULL
  OR golf_ball_brand IS NOT NULL
ON CONFLICT (profile_id, sport_key)
DO UPDATE SET
  settings = EXCLUDED.settings,
  updated_at = NOW();

-- =====================================================
-- STEP 6: DROP OLD GOLF COLUMNS FROM PROFILES
-- =====================================================

-- IMPORTANT: Only uncomment and run these after verifying
-- the migration worked and your app is updated to use sport_settings

-- ALTER TABLE profiles DROP COLUMN IF EXISTS golf_handicap;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS golf_home_course;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS golf_tee_preference;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS golf_dominant_hand;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS golf_driver_brand;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS golf_driver_loft;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS golf_irons_brand;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS golf_putter_brand;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS golf_ball_brand;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

DO $$
DECLARE
  profiles_with_golf INTEGER;
  migrated_records INTEGER;
BEGIN
  -- Count profiles with golf data
  SELECT COUNT(*) INTO profiles_with_golf
  FROM profiles
  WHERE
    golf_handicap IS NOT NULL
    OR golf_home_course IS NOT NULL
    OR golf_tee_preference IS NOT NULL
    OR golf_dominant_hand IS NOT NULL
    OR golf_driver_brand IS NOT NULL
    OR golf_driver_loft IS NOT NULL
    OR golf_irons_brand IS NOT NULL
    OR golf_putter_brand IS NOT NULL
    OR golf_ball_brand IS NOT NULL;

  -- Count migrated records
  SELECT COUNT(*) INTO migrated_records
  FROM sport_settings
  WHERE sport_key = 'golf';

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    SPORT SETTINGS MIGRATION COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Table created: sport_settings';
  RAISE NOTICE 'Indexes created: 4';
  RAISE NOTICE 'RLS policies: 4 (SELECT, INSERT, UPDATE, DELETE)';
  RAISE NOTICE '';
  RAISE NOTICE 'Migration results:';
  RAISE NOTICE '  - Profiles with golf data: %', profiles_with_golf;
  RAISE NOTICE '  - Records migrated: %', migrated_records;
  RAISE NOTICE '';
  IF profiles_with_golf = migrated_records THEN
    RAISE NOTICE '✅ SUCCESS: All golf data migrated correctly!';
  ELSE
    RAISE NOTICE '⚠️  WARNING: Mismatch in record counts. Review migration.';
  END IF;
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Update your API to use sport_settings table';
  RAISE NOTICE '  2. Update EditProfileTabs.tsx to fetch/save sport settings';
  RAISE NOTICE '  3. Test that golf features work correctly';
  RAISE NOTICE '  4. After verification, uncomment STEP 6 to drop old columns';
  RAISE NOTICE '';
END $$;

-- =====================================================
-- SAMPLE QUERIES FOR TESTING
-- =====================================================

-- View all golf settings
-- SELECT
--   p.first_name,
--   p.last_name,
--   s.settings
-- FROM sport_settings s
-- JOIN profiles p ON p.id = s.profile_id
-- WHERE s.sport_key = 'golf';

-- View a specific user's golf settings
-- SELECT settings FROM sport_settings
-- WHERE profile_id = 'YOUR_USER_ID' AND sport_key = 'golf';

-- Update a user's golf settings (example)
-- UPDATE sport_settings
-- SET settings = jsonb_set(settings, '{handicap}', '12')
-- WHERE profile_id = 'YOUR_USER_ID' AND sport_key = 'golf';

-- =====================================================
-- ROLLBACK PLAN (if needed)
-- =====================================================

-- If something goes wrong, you can restore golf data from sport_settings:
-- UPDATE profiles p
-- SET
--   golf_handicap = (s.settings->>'handicap')::numeric,
--   golf_home_course = s.settings->>'home_course',
--   golf_tee_preference = s.settings->>'tee_preference',
--   golf_dominant_hand = s.settings->>'dominant_hand',
--   golf_driver_brand = s.settings->>'driver_brand',
--   golf_driver_loft = (s.settings->>'driver_loft')::numeric,
--   golf_irons_brand = s.settings->>'irons_brand',
--   golf_putter_brand = s.settings->>'putter_brand',
--   golf_ball_brand = s.settings->>'ball_brand'
-- FROM sport_settings s
-- WHERE s.profile_id = p.id AND s.sport_key = 'golf';
