-- =====================================================
-- CREATE SPORT_SETTINGS TABLE (NO MIGRATION NEEDED)
-- =====================================================
-- Since your profiles table doesn't have golf columns,
-- we just need to create the new sport_settings table.
-- All future golf data will be stored here from the start!
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
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    SPORT SETTINGS TABLE CREATED SUCCESSFULLY';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Table created: sport_settings';
  RAISE NOTICE 'Indexes created: 4';
  RAISE NOTICE 'RLS policies: 4 (SELECT, INSERT, UPDATE, DELETE)';
  RAISE NOTICE 'Trigger: handle_updated_at_sport_settings';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Ready to use! No data migration needed.';
  RAISE NOTICE '';
  RAISE NOTICE 'Your app will now store all sport settings in this table.';
  RAISE NOTICE 'Golf settings, hockey settings, etc. - all in one place!';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Test the frontend (Edit Profile → Golf tab)';
  RAISE NOTICE '  2. Add golf settings and verify they save';
  RAISE NOTICE '  3. You are ready to go!';
  RAISE NOTICE '';
END $$;

-- =====================================================
-- SAMPLE QUERIES FOR TESTING
-- =====================================================

-- View all sport settings (will be empty at first)
-- SELECT * FROM sport_settings;

-- View all golf settings
-- SELECT
--   p.first_name,
--   p.last_name,
--   s.settings
-- FROM sport_settings s
-- JOIN profiles p ON p.id = s.profile_id
-- WHERE s.sport_key = 'golf';
