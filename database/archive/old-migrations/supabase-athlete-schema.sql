-- CORRECTED ATHLETE PROFILE SCHEMA FOR SUPABASE
-- This matches the actual implementation in our athlete page
-- Run this in Supabase SQL Editor

-- =====================================================
-- 1. EXTEND PROFILES TABLE
-- =====================================================

-- Add athlete-specific columns to existing profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sport TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS coach TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS graduation_year INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gpa NUMERIC(3,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sat_score INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS act_score INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- =====================================================
-- 2. CREATE ATHLETE BADGES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  badge_type TEXT NOT NULL,
  display_order INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on athlete_badges
ALTER TABLE athlete_badges ENABLE ROW LEVEL SECURITY;

-- RLS Policies for athlete_badges
CREATE POLICY "Users can view their own badges" ON athlete_badges
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own badges" ON athlete_badges
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own badges" ON athlete_badges
  FOR UPDATE USING (auth.uid()::text = user_id);

CREATE POLICY "Users can delete their own badges" ON athlete_badges
  FOR DELETE USING (auth.uid()::text = user_id);

-- =====================================================
-- 3. CREATE ATHLETE VITALS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_vitals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  height_feet INTEGER,
  height_inches INTEGER,
  weight_display NUMERIC,
  weight_unit TEXT DEFAULT 'lbs',
  wingspan_feet INTEGER,
  wingspan_inches INTEGER,
  vertical_jump_inches INTEGER,
  forty_yard_dash NUMERIC,
  bench_press INTEGER,
  squat INTEGER,
  deadlift INTEGER,
  resting_heart_rate INTEGER,
  vo2_max INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on athlete_vitals
ALTER TABLE athlete_vitals ENABLE ROW LEVEL SECURITY;

-- RLS Policies for athlete_vitals
CREATE POLICY "Users can view their own vitals" ON athlete_vitals
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can manage their own vitals" ON athlete_vitals
  FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- =====================================================
-- 4. CREATE ATHLETE SOCIALS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_socials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL, -- 'twitter', 'instagram', 'tiktok', etc.
  handle TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on athlete_socials  
ALTER TABLE athlete_socials ENABLE ROW LEVEL SECURITY;

-- RLS Policies for athlete_socials
CREATE POLICY "Anyone can view social links" ON athlete_socials
  FOR SELECT USING (true);

CREATE POLICY "Users can manage their own socials" ON athlete_socials
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own socials" ON athlete_socials
  FOR UPDATE USING (auth.uid()::text = user_id);

CREATE POLICY "Users can delete their own socials" ON athlete_socials
  FOR DELETE USING (auth.uid()::text = user_id);

-- =====================================================
-- 5. CREATE ATHLETE PERFORMANCES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_performances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  result TEXT NOT NULL,
  place INTEGER,
  date DATE NOT NULL,
  location TEXT,
  notes TEXT,
  public_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on athlete_performances
ALTER TABLE athlete_performances ENABLE ROW LEVEL SECURITY;

-- RLS Policies for athlete_performances
CREATE POLICY "Users can view their own performances or public ones" ON athlete_performances
  FOR SELECT USING (auth.uid()::text = user_id OR public_visible = true);

CREATE POLICY "Users can manage their own performances" ON athlete_performances
  FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- =====================================================
-- 6. CREATE ATHLETE SEASON HIGHLIGHTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_season_highlights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  stat_name TEXT NOT NULL,
  stat_value TEXT NOT NULL,
  stat_context TEXT,
  display_order INTEGER DEFAULT 1,
  season TEXT DEFAULT '2024-2025',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on athlete_season_highlights
ALTER TABLE athlete_season_highlights ENABLE ROW LEVEL SECURITY;

-- RLS Policies for athlete_season_highlights
CREATE POLICY "Users can view their own highlights" ON athlete_season_highlights
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can manage their own highlights" ON athlete_season_highlights
  FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- =====================================================
-- 7. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

-- Indexes for athlete_badges
CREATE INDEX IF NOT EXISTS idx_athlete_badges_user_id ON athlete_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_athlete_badges_display_order ON athlete_badges(user_id, display_order);

-- Indexes for athlete_vitals
CREATE INDEX IF NOT EXISTS idx_athlete_vitals_user_id ON athlete_vitals(user_id);

-- Indexes for athlete_socials
CREATE INDEX IF NOT EXISTS idx_athlete_socials_user_id ON athlete_socials(user_id);
CREATE INDEX IF NOT EXISTS idx_athlete_socials_platform ON athlete_socials(user_id, platform);

-- Indexes for athlete_performances
CREATE INDEX IF NOT EXISTS idx_athlete_performances_user_id ON athlete_performances(user_id);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_date ON athlete_performances(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_public ON athlete_performances(public_visible);

-- Indexes for athlete_season_highlights
CREATE INDEX IF NOT EXISTS idx_athlete_season_highlights_user_id ON athlete_season_highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_athlete_season_highlights_display_order ON athlete_season_highlights(user_id, display_order);
CREATE INDEX IF NOT EXISTS idx_athlete_season_highlights_season ON athlete_season_highlights(user_id, season);

-- =====================================================
-- 8. CREATE STORAGE BUCKETS AND POLICIES
-- =====================================================

-- Create uploads bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for uploads bucket
DO $$ 
BEGIN 
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Users can upload their own files" ON storage.objects;
  DROP POLICY IF EXISTS "Users can view their own files" ON storage.objects;
  DROP POLICY IF EXISTS "Users can update their own files" ON storage.objects;
  DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;
  DROP POLICY IF EXISTS "Public read access for uploads" ON storage.objects;
  
  -- Create new policies
  CREATE POLICY "Users can upload their own files" ON storage.objects
    FOR INSERT WITH CHECK (
      bucket_id = 'uploads' AND 
      auth.uid()::text = (storage.foldername(name))[1]
    );

  CREATE POLICY "Public read access for uploads" ON storage.objects
    FOR SELECT USING (bucket_id = 'uploads');

  CREATE POLICY "Users can update their own files" ON storage.objects
    FOR UPDATE USING (
      bucket_id = 'uploads' AND 
      auth.uid()::text = (storage.foldername(name))[1]
    );

  CREATE POLICY "Users can delete their own files" ON storage.objects
    FOR DELETE USING (
      bucket_id = 'uploads' AND 
      auth.uid()::text = (storage.foldername(name))[1]
    );
END $$;

-- =====================================================
-- 9. CREATE UPDATE TRIGGERS
-- =====================================================

-- Create or update the updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

-- Add triggers for updated_at
CREATE TRIGGER handle_updated_at_athlete_badges
  BEFORE UPDATE ON athlete_badges
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_updated_at_athlete_vitals
  BEFORE UPDATE ON athlete_vitals
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_updated_at_athlete_socials
  BEFORE UPDATE ON athlete_socials
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_updated_at_athlete_performances
  BEFORE UPDATE ON athlete_performances
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_updated_at_athlete_season_highlights
  BEFORE UPDATE ON athlete_season_highlights
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- =====================================================
-- 10. VERIFICATION QUERIES
-- =====================================================

-- Check that all tables exist
SELECT 
  table_name,
  table_type
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE '%athlete%'
ORDER BY table_name;

-- Check RLS is enabled on all tables
SELECT 
  schemaname, 
  tablename, 
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename LIKE '%athlete%'
ORDER BY tablename;

-- Check storage bucket exists
SELECT * FROM storage.buckets WHERE id = 'uploads';

-- SUCCESS MESSAGE
DO $$
BEGIN
  RAISE NOTICE '✅ Athlete profile schema setup complete!';
  RAISE NOTICE 'Tables created:';
  RAISE NOTICE '  - Extended profiles table with athlete fields';
  RAISE NOTICE '  - athlete_badges';
  RAISE NOTICE '  - athlete_vitals';
  RAISE NOTICE '  - athlete_socials';
  RAISE NOTICE '  - athlete_performances';
  RAISE NOTICE '  - athlete_season_highlights';
  RAISE NOTICE 'RLS policies configured for all tables';
  RAISE NOTICE 'Storage bucket "uploads" ready';
  RAISE NOTICE 'Indexes created for performance';
END $$;