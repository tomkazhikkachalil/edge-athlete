-- COMPLETE GOLF SCHEMA SETUP
-- Run this ENTIRE file in Supabase SQL Editor to set up golf functionality
-- This creates tables, triggers, functions, and RLS policies

-- =====================================================
-- 1. CREATE GOLF ROUNDS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS golf_rounds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Round basics
  date DATE NOT NULL,
  course TEXT NOT NULL,
  course_location TEXT,
  tee TEXT,
  holes INTEGER NOT NULL DEFAULT 18 CHECK (holes IN (9, 18)),
  par INTEGER DEFAULT 72,

  -- Scorecard summary (calculated from holes)
  gross_score INTEGER,
  fir_percentage DECIMAL(5,2) CHECK (fir_percentage >= 0 AND fir_percentage <= 100),
  gir_percentage DECIMAL(5,2) CHECK (gir_percentage >= 0 AND gir_percentage <= 100),
  total_putts INTEGER,

  -- Metadata
  notes TEXT,
  is_complete BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE golf_rounds ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their own golf rounds" ON golf_rounds;
CREATE POLICY "Users can view their own golf rounds" ON golf_rounds
  FOR SELECT USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "Users can insert their own golf rounds" ON golf_rounds;
CREATE POLICY "Users can insert their own golf rounds" ON golf_rounds
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "Users can update their own golf rounds" ON golf_rounds;
CREATE POLICY "Users can update their own golf rounds" ON golf_rounds
  FOR UPDATE USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "Users can delete their own golf rounds" ON golf_rounds;
CREATE POLICY "Users can delete their own golf rounds" ON golf_rounds
  FOR DELETE USING (auth.uid() = profile_id);

-- =====================================================
-- 2. CREATE GOLF HOLES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS golf_holes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  round_id UUID REFERENCES golf_rounds(id) ON DELETE CASCADE NOT NULL,

  -- Hole basics
  hole_number INTEGER NOT NULL CHECK (hole_number >= 1 AND hole_number <= 18),
  par INTEGER CHECK (par >= 3 AND par <= 6),

  -- Performance
  strokes INTEGER CHECK (strokes >= 1 AND strokes <= 15),
  putts INTEGER CHECK (putts >= 0 AND putts <= 8),
  fairway_hit BOOLEAN,
  green_in_regulation BOOLEAN,

  -- Optional details
  distance_yards INTEGER,
  club_off_tee TEXT,
  notes TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

  UNIQUE(round_id, hole_number)
);

-- Enable RLS
ALTER TABLE golf_holes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view holes for their rounds" ON golf_holes;
CREATE POLICY "Users can view holes for their rounds" ON golf_holes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM golf_rounds
      WHERE golf_rounds.id = golf_holes.round_id
      AND golf_rounds.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert holes for their rounds" ON golf_holes;
CREATE POLICY "Users can insert holes for their rounds" ON golf_holes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM golf_rounds
      WHERE golf_rounds.id = golf_holes.round_id
      AND golf_rounds.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update holes for their rounds" ON golf_holes;
CREATE POLICY "Users can update holes for their rounds" ON golf_holes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM golf_rounds
      WHERE golf_rounds.id = golf_holes.round_id
      AND golf_rounds.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete holes for their rounds" ON golf_holes;
CREATE POLICY "Users can delete holes for their rounds" ON golf_holes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM golf_rounds
      WHERE golf_rounds.id = golf_holes.round_id
      AND golf_rounds.profile_id = auth.uid()
    )
  );

-- =====================================================
-- 3. CREATE STATS CALCULATION FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_round_stats(round_uuid UUID)
RETURNS VOID AS $$
DECLARE
    total_strokes INTEGER;
    total_putts_calc INTEGER;
    fir_count INTEGER;
    fir_eligible INTEGER;
    gir_count INTEGER;
    total_holes INTEGER;
BEGIN
    -- Get basic stats from holes
    SELECT
        COALESCE(SUM(strokes), 0),
        COALESCE(SUM(putts), 0),
        COUNT(*) FILTER (WHERE fairway_hit = true),
        COUNT(*) FILTER (WHERE par > 3),
        COUNT(*) FILTER (WHERE green_in_regulation = true),
        COUNT(*)
    INTO total_strokes, total_putts_calc, fir_count, fir_eligible, gir_count, total_holes
    FROM golf_holes
    WHERE round_id = round_uuid;

    -- Update round with calculated stats
    UPDATE golf_rounds
    SET
        gross_score = CASE WHEN total_strokes > 0 THEN total_strokes ELSE gross_score END,
        total_putts = CASE WHEN total_putts_calc > 0 THEN total_putts_calc ELSE total_putts END,
        fir_percentage = CASE WHEN fir_eligible > 0 THEN ROUND((fir_count::decimal / fir_eligible) * 100, 1) ELSE fir_percentage END,
        gir_percentage = CASE WHEN total_holes > 0 THEN ROUND((gir_count::decimal / total_holes) * 100, 1) ELSE gir_percentage END,
        is_complete = (total_holes >= holes),
        updated_at = now()
    WHERE id = round_uuid;
END;
$$ LANGUAGE 'plpgsql';

-- =====================================================
-- 4. ADD GOLF FIELDS TO POSTS TABLE
-- =====================================================

-- Add round_id to link posts to golf rounds
ALTER TABLE posts ADD COLUMN IF NOT EXISTS round_id UUID REFERENCES golf_rounds(id) ON DELETE SET NULL;

-- Add golf_mode to track post type
ALTER TABLE posts ADD COLUMN IF NOT EXISTS golf_mode TEXT CHECK (golf_mode IN ('round_recap', 'hole_highlight', null));

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_posts_round_id ON posts(round_id);

-- =====================================================
-- 5. UPDATE RLS FOR PUBLIC GOLF ROUNDS
-- =====================================================

-- Allow viewing golf rounds through public posts
DROP POLICY IF EXISTS "Users can view golf rounds through posts" ON golf_rounds;
CREATE POLICY "Users can view golf rounds through posts" ON golf_rounds
  FOR SELECT USING (
    auth.uid() = profile_id OR
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.round_id = golf_rounds.id
      AND posts.visibility = 'public'
    )
  );

-- Allow viewing golf holes through public posts
DROP POLICY IF EXISTS "Users can view holes through posts" ON golf_holes;
CREATE POLICY "Users can view holes through posts" ON golf_holes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM golf_rounds
      WHERE golf_rounds.id = golf_holes.round_id
      AND (
        golf_rounds.profile_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM posts
          WHERE posts.round_id = golf_rounds.id
          AND posts.visibility = 'public'
        )
      )
    )
  );

-- =====================================================
-- 6. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_golf_rounds_profile_id ON golf_rounds(profile_id);
CREATE INDEX IF NOT EXISTS idx_golf_rounds_date ON golf_rounds(date DESC);
CREATE INDEX IF NOT EXISTS idx_golf_holes_round_id ON golf_holes(round_id);

-- =====================================================
-- VERIFICATION QUERY
-- =====================================================

-- Run this to verify everything was created successfully
SELECT
  'golf_rounds' as table_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'golf_rounds') as exists
UNION ALL
SELECT
  'golf_holes' as table_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'golf_holes') as exists
UNION ALL
SELECT
  'posts.round_id' as column_name,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'round_id') as exists;
