-- Athlete Profile Database Schema Extension
-- Add this to your existing supabase-setup.sql or run separately

-- Extend existing profiles table with athlete-specific fields
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS height_cm INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weight_kg INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dob DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS class_year INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_twitter TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_instagram TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_facebook TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create athlete_badges table
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

-- Create sports table
CREATE TABLE IF NOT EXISTS sports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sport_key TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create season_highlights table
CREATE TABLE IF NOT EXISTS season_highlights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sport_key TEXT NOT NULL,
  season TEXT NOT NULL,
  metric_a NUMERIC,
  metric_b NUMERIC,
  metric_c NUMERIC,
  rating NUMERIC CHECK (rating >= 0 AND rating <= 100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create performances table
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

-- Enable Row Level Security on all new tables
ALTER TABLE athlete_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE performances ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for athlete_badges
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

-- Create RLS policies for sports
CREATE POLICY "Users can view their own sports" 
  ON sports FOR SELECT 
  USING (profile_id = auth.uid());

CREATE POLICY "Users can manage their own sports" 
  ON sports FOR ALL 
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- Create RLS policies for season_highlights
CREATE POLICY "Users can view their own highlights" 
  ON season_highlights FOR SELECT 
  USING (profile_id = auth.uid());

CREATE POLICY "Users can manage their own highlights" 
  ON season_highlights FOR ALL 
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- Create RLS policies for performances
CREATE POLICY "Users can view their own performances" 
  ON performances FOR SELECT 
  USING (profile_id = auth.uid());

CREATE POLICY "Users can manage their own performances" 
  ON performances FOR ALL 
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- Add updated_at triggers for all new tables
CREATE TRIGGER handle_updated_at_athlete_badges
  BEFORE UPDATE ON athlete_badges
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_updated_at_sports
  BEFORE UPDATE ON sports
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_updated_at_season_highlights
  BEFORE UPDATE ON season_highlights
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_updated_at_performances
  BEFORE UPDATE ON performances
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true),
       ('badges', 'badges', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for avatars
CREATE POLICY "Avatar images are publicly accessible" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatars" 
  ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatars" 
  ON storage.objects FOR UPDATE 
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create storage policies for badges
CREATE POLICY "Badge images are publicly accessible" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'badges');

-- Optional: Allow admins to upload badge icons
-- CREATE POLICY "Admins can upload badge icons" 
--   ON storage.objects FOR INSERT 
--   WITH CHECK (bucket_id = 'badges' AND auth.jwt() ->> 'role' = 'admin');

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_athlete_badges_profile_id ON athlete_badges(profile_id);
CREATE INDEX IF NOT EXISTS idx_athlete_badges_position ON athlete_badges(profile_id, position);
CREATE INDEX IF NOT EXISTS idx_sports_profile_id ON sports(profile_id);
CREATE INDEX IF NOT EXISTS idx_sports_active ON sports(profile_id, active);
CREATE INDEX IF NOT EXISTS idx_season_highlights_profile_id ON season_highlights(profile_id);
CREATE INDEX IF NOT EXISTS idx_season_highlights_season ON season_highlights(profile_id, season);
CREATE INDEX IF NOT EXISTS idx_performances_profile_id ON performances(profile_id);
CREATE INDEX IF NOT EXISTS idx_performances_date ON performances(profile_id, date DESC);

-- Insert some sample data (optional - remove in production)
-- Sample badges
INSERT INTO athlete_badges (profile_id, label, color_token, position) 
SELECT id, 'NCAA D1', 'primary', 1 FROM profiles LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO athlete_badges (profile_id, label, color_token, position) 
SELECT id, 'Team Captain', 'purple', 2 FROM profiles LIMIT 1
ON CONFLICT DO NOTHING;