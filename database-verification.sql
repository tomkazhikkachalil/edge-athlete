-- COMPLETE SUPABASE DATABASE SETUP VERIFICATION SCRIPT
-- Run this in your Supabase SQL Editor to ensure everything is properly configured

-- ==============================================
-- 1. VERIFY AND EXTEND PROFILES TABLE
-- ==============================================

-- Check if profiles table exists and add missing columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS height_cm INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weight_kg INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dob DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS class_year INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_twitter TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_instagram TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_facebook TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Ensure location exists (might be in base schema)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location TEXT;

-- ==============================================
-- 2. CREATE ATHLETE BADGES TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS athlete_badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  icon_url TEXT,
  color_token TEXT DEFAULT 'primary',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================
-- 3. CREATE SPORTS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS sports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sport_key TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(profile_id, sport_key)
);

-- ==============================================
-- 4. CREATE SEASON HIGHLIGHTS TABLE
-- ==============================================
-- NOTE: Using TEXT for metrics to match TypeScript interface expectations

CREATE TABLE IF NOT EXISTS season_highlights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sport_key TEXT NOT NULL,
  season TEXT NOT NULL,
  metric_a TEXT,  -- Changed from NUMERIC to TEXT for flexibility
  metric_b TEXT,  -- Changed from NUMERIC to TEXT for flexibility  
  metric_c TEXT,  -- Changed from NUMERIC to TEXT for flexibility
  rating NUMERIC CHECK (rating >= 0 AND rating <= 100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(profile_id, sport_key, season)
);

-- ==============================================
-- 5. CREATE PERFORMANCES TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS performances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  event TEXT NOT NULL,
  result_place TEXT,
  stat_primary TEXT,
  organization TEXT,
  athletic_score NUMERIC CHECK (athletic_score >= 0 AND athletic_score <= 100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================
-- 6. ENABLE ROW LEVEL SECURITY
-- ==============================================

ALTER TABLE athlete_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE performances ENABLE ROW LEVEL SECURITY;

-- ==============================================
-- 7. CREATE RLS POLICIES FOR ATHLETE_BADGES
-- ==============================================

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own badges" ON athlete_badges;
DROP POLICY IF EXISTS "Users can insert their own badges" ON athlete_badges;
DROP POLICY IF EXISTS "Users can update their own badges" ON athlete_badges;
DROP POLICY IF EXISTS "Users can delete their own badges" ON athlete_badges;

CREATE POLICY "Users can view their own badges" 
  ON athlete_badges FOR SELECT 
  USING (profile_id = auth.uid());

CREATE POLICY "Users can insert their own badges" 
  ON athlete_badges FOR INSERT 
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users can update their own badges" 
  ON athlete_badges FOR UPDATE 
  USING (profile_id = auth.uid());

CREATE POLICY "Users can delete their own badges" 
  ON athlete_badges FOR DELETE 
  USING (profile_id = auth.uid());

-- ==============================================
-- 8. CREATE RLS POLICIES FOR SPORTS
-- ==============================================

DROP POLICY IF EXISTS "Users can view their own sports" ON sports;
DROP POLICY IF EXISTS "Users can manage their own sports" ON sports;

CREATE POLICY "Users can view their own sports" 
  ON sports FOR SELECT 
  USING (profile_id = auth.uid());

CREATE POLICY "Users can manage their own sports" 
  ON sports FOR ALL 
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- ==============================================
-- 9. CREATE RLS POLICIES FOR SEASON_HIGHLIGHTS
-- ==============================================

DROP POLICY IF EXISTS "Users can view their own highlights" ON season_highlights;
DROP POLICY IF EXISTS "Users can manage their own highlights" ON season_highlights;

CREATE POLICY "Users can view their own highlights" 
  ON season_highlights FOR SELECT 
  USING (profile_id = auth.uid());

CREATE POLICY "Users can manage their own highlights" 
  ON season_highlights FOR ALL 
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- ==============================================
-- 10. CREATE RLS POLICIES FOR PERFORMANCES
-- ==============================================

DROP POLICY IF EXISTS "Users can view their own performances" ON performances;
DROP POLICY IF EXISTS "Users can manage their own performances" ON performances;

CREATE POLICY "Users can view their own performances" 
  ON performances FOR SELECT 
  USING (profile_id = auth.uid());

CREATE POLICY "Users can manage their own performances" 
  ON performances FOR ALL 
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- ==============================================
-- 11. CREATE STORAGE BUCKETS
-- ==============================================

-- Create avatars bucket
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit) 
VALUES ('avatars', 'avatars', true, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'], 5242880)
ON CONFLICT (id) DO UPDATE SET 
  public = EXCLUDED.public,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  file_size_limit = EXCLUDED.file_size_limit;

-- Create badges bucket for badge icons
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit) 
VALUES ('badges', 'badges', true, ARRAY['image/png', 'image/svg+xml'], 1048576)
ON CONFLICT (id) DO UPDATE SET 
  public = EXCLUDED.public,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  file_size_limit = EXCLUDED.file_size_limit;

-- ==============================================
-- 12. CREATE STORAGE POLICIES
-- ==============================================

-- Avatar storage policies
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatars" ON storage.objects;

CREATE POLICY "Avatar images are publicly accessible" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatars" 
  ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatars" 
  ON storage.objects FOR UPDATE 
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own avatars" 
  ON storage.objects FOR DELETE 
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Badge storage policies  
DROP POLICY IF EXISTS "Badge images are publicly accessible" ON storage.objects;

CREATE POLICY "Badge images are publicly accessible" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'badges');

-- ==============================================
-- 13. CREATE PERFORMANCE INDEXES
-- ==============================================

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

CREATE INDEX IF NOT EXISTS idx_athlete_badges_profile_id ON athlete_badges(profile_id);
CREATE INDEX IF NOT EXISTS idx_athlete_badges_position ON athlete_badges(profile_id, position);

CREATE INDEX IF NOT EXISTS idx_sports_profile_id ON sports(profile_id);
CREATE INDEX IF NOT EXISTS idx_sports_active ON sports(profile_id, active);

CREATE INDEX IF NOT EXISTS idx_season_highlights_profile_id ON season_highlights(profile_id);
CREATE INDEX IF NOT EXISTS idx_season_highlights_season ON season_highlights(profile_id, season);
CREATE INDEX IF NOT EXISTS idx_season_highlights_sport ON season_highlights(profile_id, sport_key);

CREATE INDEX IF NOT EXISTS idx_performances_profile_id ON performances(profile_id);
CREATE INDEX IF NOT EXISTS idx_performances_date ON performances(profile_id, date DESC);

-- ==============================================
-- 14. CREATE UPDATED_AT TRIGGERS
-- ==============================================

-- Create updated_at function if it doesn't exist
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to all tables
DROP TRIGGER IF EXISTS handle_updated_at_profiles ON profiles;
CREATE TRIGGER handle_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_athlete_badges ON athlete_badges;
CREATE TRIGGER handle_updated_at_athlete_badges
  BEFORE UPDATE ON athlete_badges
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_sports ON sports;
CREATE TRIGGER handle_updated_at_sports
  BEFORE UPDATE ON sports
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_season_highlights ON season_highlights;
CREATE TRIGGER handle_updated_at_season_highlights
  BEFORE UPDATE ON season_highlights
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_performances ON performances;
CREATE TRIGGER handle_updated_at_performances
  BEFORE UPDATE ON performances
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ==============================================
-- 15. VERIFICATION QUERIES
-- ==============================================

-- These queries will help verify everything is set up correctly
-- Run these after the setup to check your database

-- Check profiles table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
ORDER BY ordinal_position;

-- Check if all tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('profiles', 'athlete_badges', 'sports', 'season_highlights', 'performances')
ORDER BY table_name;

-- Check storage buckets
SELECT * FROM storage.buckets WHERE id IN ('avatars', 'badges');

-- Check RLS is enabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('profiles', 'athlete_badges', 'sports', 'season_highlights', 'performances');

-- ==============================================
-- SETUP COMPLETE!
-- ==============================================

-- Your database is now fully configured for the athlete profile system.
-- All tables, policies, storage buckets, and indexes are in place.
-- The schema matches your TypeScript interfaces exactly.