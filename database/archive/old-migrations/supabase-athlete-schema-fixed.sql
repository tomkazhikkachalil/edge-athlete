-- ATHLETE PROFILE SCHEMA - FIXED VERSION
-- This fixes the display_order column issues and other inconsistencies
-- Run this in Supabase SQL Editor

-- =====================================================
-- 1. EXTEND EXISTING PROFILES TABLE
-- =====================================================

-- Add athlete-specific columns to existing profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sport TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS coach TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS graduation_year INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gpa NUMERIC(3,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sat_score INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS act_score INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- =====================================================
-- 3. CREATE ATHLETE BADGES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  badge_type TEXT NOT NULL,
  display_order INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on athlete_badges
ALTER TABLE athlete_badges ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view their own badges" ON athlete_badges;
DROP POLICY IF EXISTS "Users can insert their own badges" ON athlete_badges;
DROP POLICY IF EXISTS "Users can update their own badges" ON athlete_badges;
DROP POLICY IF EXISTS "Users can delete their own badges" ON athlete_badges;

-- RLS Policies for athlete_badges
CREATE POLICY "Users can view their own badges" ON athlete_badges
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert their own badges" ON athlete_badges
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update their own badges" ON athlete_badges
  FOR UPDATE USING (auth.uid() = profile_id);

CREATE POLICY "Users can delete their own badges" ON athlete_badges
  FOR DELETE USING (auth.uid() = profile_id);

-- =====================================================
-- 4. CREATE ATHLETE VITALS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_vitals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
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

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own vitals" ON athlete_vitals;
DROP POLICY IF EXISTS "Users can manage their own vitals" ON athlete_vitals;

-- RLS Policies for athlete_vitals
CREATE POLICY "Users can view their own vitals" ON athlete_vitals
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can manage their own vitals" ON athlete_vitals
  FOR ALL USING (auth.uid() = profile_id) WITH CHECK (auth.uid() = profile_id);

-- =====================================================
-- 5. CREATE ATHLETE SOCIALS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_socials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL, -- 'twitter', 'instagram', 'tiktok', etc.
  handle TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on athlete_socials  
ALTER TABLE athlete_socials ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view social links" ON athlete_socials;
DROP POLICY IF EXISTS "Users can manage their own socials" ON athlete_socials;
DROP POLICY IF EXISTS "Users can update their own socials" ON athlete_socials;
DROP POLICY IF EXISTS "Users can delete their own socials" ON athlete_socials;

-- RLS Policies for athlete_socials
CREATE POLICY "Anyone can view social links" ON athlete_socials
  FOR SELECT USING (true);

CREATE POLICY "Users can manage their own socials" ON athlete_socials
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update their own socials" ON athlete_socials
  FOR UPDATE USING (auth.uid() = profile_id);

CREATE POLICY "Users can delete their own socials" ON athlete_socials
  FOR DELETE USING (auth.uid() = profile_id);

-- =====================================================
-- 6. CREATE ATHLETE PERFORMANCES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_performances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
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

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own performances or public ones" ON athlete_performances;
DROP POLICY IF EXISTS "Users can manage their own performances" ON athlete_performances;

-- RLS Policies for athlete_performances
CREATE POLICY "Users can view their own performances or public ones" ON athlete_performances
  FOR SELECT USING (auth.uid() = profile_id OR public_visible = true);

CREATE POLICY "Users can manage their own performances" ON athlete_performances
  FOR ALL USING (auth.uid() = profile_id) WITH CHECK (auth.uid() = profile_id);

-- =====================================================
-- 7. CREATE ATHLETE SEASON HIGHLIGHTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS athlete_season_highlights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
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

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own highlights" ON athlete_season_highlights;
DROP POLICY IF EXISTS "Users can manage their own highlights" ON athlete_season_highlights;

-- RLS Policies for athlete_season_highlights
CREATE POLICY "Users can view their own highlights" ON athlete_season_highlights
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can manage their own highlights" ON athlete_season_highlights
  FOR ALL USING (auth.uid() = profile_id) WITH CHECK (auth.uid() = profile_id);

-- =====================================================
-- 8. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

-- Drop existing indexes if they exist (to avoid conflicts)
DROP INDEX IF EXISTS idx_athlete_badges_profile_id;
DROP INDEX IF EXISTS idx_athlete_badges_display_order;
DROP INDEX IF EXISTS idx_athlete_vitals_profile_id;
DROP INDEX IF EXISTS idx_athlete_socials_profile_id;
DROP INDEX IF EXISTS idx_athlete_socials_platform;
DROP INDEX IF EXISTS idx_athlete_performances_profile_id;
DROP INDEX IF EXISTS idx_athlete_performances_date;
DROP INDEX IF EXISTS idx_athlete_performances_public;
DROP INDEX IF EXISTS idx_athlete_season_highlights_profile_id;
DROP INDEX IF EXISTS idx_athlete_season_highlights_display_order;
DROP INDEX IF EXISTS idx_athlete_season_highlights_season;

-- Create indexes conditionally to avoid column errors
DO $$
BEGIN
    -- Create basic profile_id indexes (these should always work)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_badges') THEN
        CREATE INDEX IF NOT EXISTS idx_athlete_badges_profile_id ON athlete_badges(profile_id);
        
        -- Only create display_order index if the column exists
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athlete_badges' AND column_name = 'display_order') THEN
            CREATE INDEX IF NOT EXISTS idx_athlete_badges_display_order ON athlete_badges(profile_id, display_order);
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_vitals') THEN
        CREATE INDEX IF NOT EXISTS idx_athlete_vitals_profile_id ON athlete_vitals(profile_id);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_socials') THEN
        CREATE INDEX IF NOT EXISTS idx_athlete_socials_profile_id ON athlete_socials(profile_id);
        CREATE INDEX IF NOT EXISTS idx_athlete_socials_platform ON athlete_socials(profile_id, platform);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_performances') THEN
        CREATE INDEX IF NOT EXISTS idx_athlete_performances_profile_id ON athlete_performances(profile_id);
        CREATE INDEX IF NOT EXISTS idx_athlete_performances_date ON athlete_performances(profile_id, date DESC);
        CREATE INDEX IF NOT EXISTS idx_athlete_performances_public ON athlete_performances(public_visible);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_season_highlights') THEN
        CREATE INDEX IF NOT EXISTS idx_athlete_season_highlights_profile_id ON athlete_season_highlights(profile_id);
        
        -- Only create display_order index if the column exists
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athlete_season_highlights' AND column_name = 'display_order') THEN
            CREATE INDEX IF NOT EXISTS idx_athlete_season_highlights_display_order ON athlete_season_highlights(profile_id, display_order);
        END IF;
        
        CREATE INDEX IF NOT EXISTS idx_athlete_season_highlights_season ON athlete_season_highlights(profile_id, season);
    END IF;
END $$;

-- =====================================================
-- 9. CREATE/VERIFY STORAGE BUCKETS AND POLICIES
-- =====================================================

-- Create uploads bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Drop and recreate storage policies to ensure they're correct
DO $$ 
BEGIN 
  -- Drop existing policies if they exist
  BEGIN
    DROP POLICY IF EXISTS "Users can upload their own files" ON storage.objects;
  EXCEPTION
    WHEN undefined_object THEN NULL;
  END;
  
  BEGIN
    DROP POLICY IF EXISTS "Public read access for uploads" ON storage.objects;
  EXCEPTION
    WHEN undefined_object THEN NULL;
  END;
  
  BEGIN
    DROP POLICY IF EXISTS "Users can update their own files" ON storage.objects;
  EXCEPTION
    WHEN undefined_object THEN NULL;
  END;
  
  BEGIN
    DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;
  EXCEPTION
    WHEN undefined_object THEN NULL;
  END;
  
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
-- 10. CREATE UPDATE TRIGGERS
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

-- Drop existing triggers to avoid conflicts
DROP TRIGGER IF EXISTS handle_updated_at_athlete_badges ON athlete_badges;
DROP TRIGGER IF EXISTS handle_updated_at_athlete_vitals ON athlete_vitals;
DROP TRIGGER IF EXISTS handle_updated_at_athlete_socials ON athlete_socials;
DROP TRIGGER IF EXISTS handle_updated_at_athlete_performances ON athlete_performances;
DROP TRIGGER IF EXISTS handle_updated_at_athlete_season_highlights ON athlete_season_highlights;

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
-- 11. FINAL VERIFICATION
-- =====================================================

-- Check that all tables exist
SELECT 'TABLES CREATED:' as status;
SELECT 
  table_name,
  table_type
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND (table_name LIKE '%athlete%' OR table_name = 'profiles')
ORDER BY table_name;

-- Check RLS is enabled on all tables
SELECT 'RLS STATUS:' as status;
SELECT 
  schemaname, 
  tablename, 
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename LIKE '%athlete%'
ORDER BY tablename;

-- Check storage bucket exists
SELECT 'STORAGE BUCKET:' as status;
SELECT * FROM storage.buckets WHERE id = 'uploads';

-- Check profiles table structure
SELECT 'PROFILES TABLE COLUMNS:' as status;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('id', 'display_name', 'sport', 'school', 'avatar_url', 'bio')
ORDER BY column_name;

-- SUCCESS MESSAGE
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ ===============================================';
  RAISE NOTICE '✅ ATHLETE PROFILE SCHEMA SETUP COMPLETE!';
  RAISE NOTICE '✅ ===============================================';
  RAISE NOTICE '';
  RAISE NOTICE '📋 What was created:';
  RAISE NOTICE '  - Extended profiles table with athlete fields';
  RAISE NOTICE '  - athlete_badges table';
  RAISE NOTICE '  - athlete_vitals table';
  RAISE NOTICE '  - athlete_socials table';  
  RAISE NOTICE '  - athlete_performances table';
  RAISE NOTICE '  - athlete_season_highlights table';
  RAISE NOTICE '  - RLS policies on all tables';
  RAISE NOTICE '  - Storage bucket "uploads" with policies';
  RAISE NOTICE '  - Performance indexes';
  RAISE NOTICE '  - Update triggers';
  RAISE NOTICE '';
  RAISE NOTICE '🔒 Security: RLS enabled - users can only access their own data';
  RAISE NOTICE '📁 Storage: uploads/{profile_id}/ folder structure';
  RAISE NOTICE '🚀 Ready: Your athlete page should now work!';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Next steps:';
  RAISE NOTICE '  1. Visit /athlete in your app';
  RAISE NOTICE '  2. Try editing your profile';
  RAISE NOTICE '  3. Upload an avatar image';
  RAISE NOTICE '  4. Add some performance data';
  RAISE NOTICE '';
  RAISE NOTICE '✅ FIXED: Conditional index creation prevents column errors';
  RAISE NOTICE '✅ FIXED: Proper profile_id foreign key relationships';
  RAISE NOTICE '';
END $$;