-- PRIVACY SYSTEM IMPLEMENTATION
-- This adds public/private profile functionality with future-proof granular controls

-- =====================================================
-- PHASE 1: ADD VISIBILITY COLUMN TO PROFILES
-- =====================================================

-- Add visibility column (simple: public or private)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS visibility TEXT
DEFAULT 'public'
CHECK (visibility IN ('public', 'private'));

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_profiles_visibility ON profiles(visibility);

-- Update existing profiles to public (current behavior)
UPDATE profiles
SET visibility = 'public'
WHERE visibility IS NULL;

-- =====================================================
-- PHASE 2: CREATE PRIVACY SETTINGS TABLE (FUTURE-PROOF)
-- =====================================================

-- Granular privacy controls for future use
CREATE TABLE IF NOT EXISTS privacy_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

  -- Overall profile visibility (matches profiles.visibility)
  profile_visibility TEXT DEFAULT 'public' CHECK (profile_visibility IN ('public', 'private')),

  -- Granular controls for future (optional, defaults to 'inherit')
  media_visibility TEXT DEFAULT 'inherit' CHECK (media_visibility IN ('public', 'private', 'friends', 'inherit')),
  stats_visibility TEXT DEFAULT 'inherit' CHECK (stats_visibility IN ('public', 'private', 'friends', 'inherit')),
  posts_visibility TEXT DEFAULT 'inherit' CHECK (posts_visibility IN ('public', 'private', 'friends', 'inherit')),
  activity_visibility TEXT DEFAULT 'inherit' CHECK (activity_visibility IN ('public', 'private', 'friends', 'inherit')),

  -- 'inherit' means use profile_visibility setting

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on privacy_settings
ALTER TABLE privacy_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for privacy_settings
DROP POLICY IF EXISTS "Users can view their own privacy settings" ON privacy_settings;
CREATE POLICY "Users can view their own privacy settings" ON privacy_settings
  FOR SELECT USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "Users can update their own privacy settings" ON privacy_settings;
CREATE POLICY "Users can update their own privacy settings" ON privacy_settings
  FOR ALL USING (auth.uid() = profile_id);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_privacy_settings_profile ON privacy_settings(profile_id);

-- =====================================================
-- PHASE 3: UPDATE RLS POLICIES FOR PRIVACY
-- =====================================================

-- ===== PROFILES TABLE =====

-- Drop old policy
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view profiles based on visibility" ON profiles;

-- New policy: Respect visibility setting
CREATE POLICY "Users can view profiles based on visibility" ON profiles
  FOR SELECT USING (
    -- Own profile
    auth.uid() = id
    OR
    -- Public profiles
    visibility = 'public'
    OR
    -- Private profiles if following (with accepted status)
    (visibility = 'private' AND EXISTS (
      SELECT 1 FROM follows
      WHERE follows.follower_id = auth.uid()
        AND follows.following_id = profiles.id
        AND follows.status = 'accepted'
    ))
  );

-- ===== POSTS TABLE =====

-- Drop old policy
DROP POLICY IF EXISTS "Users can view public posts" ON posts;
DROP POLICY IF EXISTS "Users can view posts based on profile visibility" ON posts;

-- New policy: Posts visibility based on profile privacy
CREATE POLICY "Users can view posts based on profile visibility" ON posts
  FOR SELECT USING (
    -- Own posts
    profile_id = auth.uid()
    OR
    -- Public posts from public profiles
    (visibility = 'public' AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = posts.profile_id
        AND profiles.visibility = 'public'
    ))
    OR
    -- Any posts from private profiles if following
    EXISTS (
      SELECT 1 FROM profiles
      JOIN follows ON follows.following_id = profiles.id
      WHERE profiles.id = posts.profile_id
        AND profiles.visibility = 'private'
        AND follows.follower_id = auth.uid()
        AND follows.status = 'accepted'
    )
  );

-- ===== GOLF ROUNDS TABLE =====

-- Drop old policy
DROP POLICY IF EXISTS "Users can view golf rounds through posts" ON golf_rounds;
DROP POLICY IF EXISTS "Users can view golf rounds based on profile visibility" ON golf_rounds;

-- New policy: Golf rounds visibility based on profile privacy
CREATE POLICY "Users can view golf rounds based on profile visibility" ON golf_rounds
  FOR SELECT USING (
    -- Own rounds
    profile_id = auth.uid()
    OR
    -- Rounds from public profiles
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = golf_rounds.profile_id
        AND profiles.visibility = 'public'
    )
    OR
    -- Rounds from private profiles if following
    EXISTS (
      SELECT 1 FROM profiles
      JOIN follows ON follows.following_id = profiles.id
      WHERE profiles.id = golf_rounds.profile_id
        AND profiles.visibility = 'private'
        AND follows.follower_id = auth.uid()
        AND follows.status = 'accepted'
    )
  );

-- ===== GOLF HOLES TABLE =====

-- Drop old policy
DROP POLICY IF EXISTS "Users can view holes through golf rounds" ON golf_holes;
DROP POLICY IF EXISTS "Users can view golf holes based on profile visibility" ON golf_holes;

-- New policy: Golf holes inherit round visibility
CREATE POLICY "Users can view golf holes based on profile visibility" ON golf_holes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM golf_rounds
      JOIN profiles ON profiles.id = golf_rounds.profile_id
      WHERE golf_rounds.id = golf_holes.round_id
      AND (
        -- Own holes
        golf_rounds.profile_id = auth.uid()
        OR
        -- Public profile
        profiles.visibility = 'public'
        OR
        -- Private profile with follow
        (profiles.visibility = 'private' AND EXISTS (
          SELECT 1 FROM follows
          WHERE follows.follower_id = auth.uid()
            AND follows.following_id = profiles.id
            AND follows.status = 'accepted'
        ))
      )
    )
  );

-- ===== SEASON HIGHLIGHTS TABLE =====

-- Drop old policy (if exists)
DROP POLICY IF EXISTS "Users can view season highlights based on profile visibility" ON season_highlights;

-- New policy: Season highlights based on profile privacy
CREATE POLICY "Users can view season highlights based on profile visibility" ON season_highlights
  FOR SELECT USING (
    -- Own highlights
    profile_id = auth.uid()
    OR
    -- Public profile highlights
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = season_highlights.profile_id
        AND profiles.visibility = 'public'
    )
    OR
    -- Private profile highlights if following
    EXISTS (
      SELECT 1 FROM profiles
      JOIN follows ON follows.following_id = profiles.id
      WHERE profiles.id = season_highlights.profile_id
        AND profiles.visibility = 'private'
        AND follows.follower_id = auth.uid()
        AND follows.status = 'accepted'
    )
  );

-- ===== PERFORMANCES TABLE =====

-- Drop old policy (if exists)
DROP POLICY IF EXISTS "Users can view performances based on profile visibility" ON performances;

-- New policy: Performances based on profile privacy
CREATE POLICY "Users can view performances based on profile visibility" ON performances
  FOR SELECT USING (
    -- Own performances
    profile_id = auth.uid()
    OR
    -- Public profile performances
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = performances.profile_id
        AND profiles.visibility = 'public'
    )
    OR
    -- Private profile performances if following
    EXISTS (
      SELECT 1 FROM profiles
      JOIN follows ON follows.following_id = profiles.id
      WHERE profiles.id = performances.profile_id
        AND profiles.visibility = 'private'
        AND follows.follower_id = auth.uid()
        AND follows.status = 'accepted'
    )
  );

-- ===== ATHLETE BADGES TABLE =====

-- Drop old policy (if exists)
DROP POLICY IF EXISTS "Users can view badges based on profile visibility" ON athlete_badges;

-- New policy: Badges based on profile privacy
CREATE POLICY "Users can view badges based on profile visibility" ON athlete_badges
  FOR SELECT USING (
    -- Own badges
    profile_id = auth.uid()
    OR
    -- Public profile badges
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = athlete_badges.profile_id
        AND profiles.visibility = 'public'
    )
    OR
    -- Private profile badges if following
    EXISTS (
      SELECT 1 FROM profiles
      JOIN follows ON follows.following_id = profiles.id
      WHERE profiles.id = athlete_badges.profile_id
        AND profiles.visibility = 'private'
        AND follows.follower_id = auth.uid()
        AND follows.status = 'accepted'
    )
  );

-- =====================================================
-- PHASE 4: CREATE HELPER FUNCTION
-- =====================================================

-- Function to check if a user can view a profile
CREATE OR REPLACE FUNCTION can_view_profile(
  target_profile_id UUID,
  viewer_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  profile_vis TEXT;
  is_following BOOLEAN;
BEGIN
  -- Get profile visibility
  SELECT visibility INTO profile_vis
  FROM profiles
  WHERE id = target_profile_id;

  -- Own profile
  IF target_profile_id = viewer_id THEN
    RETURN TRUE;
  END IF;

  -- Public profile
  IF profile_vis = 'public' THEN
    RETURN TRUE;
  END IF;

  -- Private profile - check if following
  SELECT EXISTS (
    SELECT 1 FROM follows
    WHERE follower_id = viewer_id
      AND following_id = target_profile_id
      AND status = 'accepted'
  ) INTO is_following;

  RETURN is_following;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PHASE 5: CREATE TRIGGER TO SYNC PRIVACY SETTINGS
-- =====================================================

-- Function to sync profile visibility to privacy_settings
CREATE OR REPLACE FUNCTION sync_privacy_settings()
RETURNS TRIGGER AS $$
BEGIN
  -- When visibility changes, update or create privacy_settings
  INSERT INTO privacy_settings (profile_id, profile_visibility)
  VALUES (NEW.id, NEW.visibility)
  ON CONFLICT (profile_id)
  DO UPDATE SET
    profile_visibility = NEW.visibility,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to sync visibility
DROP TRIGGER IF EXISTS sync_profile_privacy ON profiles;
CREATE TRIGGER sync_profile_privacy
  AFTER INSERT OR UPDATE OF visibility
  ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_privacy_settings();

-- =====================================================
-- PHASE 6: INITIALIZE PRIVACY SETTINGS FOR EXISTING PROFILES
-- =====================================================

-- Create privacy_settings records for all existing profiles
INSERT INTO privacy_settings (profile_id, profile_visibility)
SELECT id, COALESCE(visibility, 'public')
FROM profiles
ON CONFLICT (profile_id) DO NOTHING;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check profiles with visibility
SELECT
  id,
  full_name,
  email,
  visibility,
  created_at
FROM profiles
ORDER BY created_at DESC
LIMIT 10;

-- Check privacy_settings were created
SELECT
  ps.profile_id,
  p.full_name,
  ps.profile_visibility,
  ps.media_visibility,
  ps.stats_visibility
FROM privacy_settings ps
JOIN profiles p ON p.id = ps.profile_id
ORDER BY ps.created_at DESC
LIMIT 10;

-- Count profiles by visibility
SELECT
  visibility,
  COUNT(*) as count
FROM profiles
GROUP BY visibility;

-- Verify RLS policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename IN ('profiles', 'posts', 'golf_rounds', 'season_highlights')
ORDER BY tablename, policyname;

-- =====================================================
-- TEST HELPER FUNCTION
-- =====================================================

-- Test can_view_profile function
-- Replace with actual profile IDs
-- SELECT can_view_profile(
--   'target-profile-id'::UUID,
--   'viewer-profile-id'::UUID
-- );

-- =====================================================
-- NOTES
-- =====================================================

-- This implementation provides:
-- ✅ Simple public/private toggle
-- ✅ Database-enforced privacy (RLS)
-- ✅ Future-proof granular controls
-- ✅ Consistent across all content types
-- ✅ Performance optimized with indexes
-- ✅ Helper function for easy checking
-- ✅ Automatic sync with trigger

-- To use in application:
-- 1. Update profile.visibility via API
-- 2. RLS automatically enforces access
-- 3. UI shows privacy indicators
-- 4. Search respects privacy settings

-- Future enhancements:
-- 1. Add granular controls UI
-- 2. Implement friends-only option
-- 3. Add privacy analytics
-- 4. Support custom privacy rules
