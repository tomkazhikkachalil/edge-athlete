-- GOLF SCHEMA - Round Recap and Hole Highlight System
-- Run this in Supabase SQL Editor to add golf functionality

-- =====================================================
-- 1. GOLF ROUNDS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS golf_rounds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  
  -- Round basics
  date DATE NOT NULL,
  course TEXT NOT NULL,
  tee TEXT, -- "Blue", "White", "Red", etc.
  holes INTEGER NOT NULL CHECK (holes IN (9, 18)),
  
  -- Scorecard summary
  gross_score INTEGER,
  par INTEGER DEFAULT 72,
  fir_percentage DECIMAL(5,2) CHECK (fir_percentage >= 0 AND fir_percentage <= 100),
  gir_percentage DECIMAL(5,2) CHECK (gir_percentage >= 0 AND gir_percentage <= 100),
  total_putts INTEGER,
  
  -- Metadata
  notes TEXT,
  is_complete BOOLEAN DEFAULT false, -- True when all holes entered
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on golf_rounds
ALTER TABLE golf_rounds ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own golf rounds" ON golf_rounds;
DROP POLICY IF EXISTS "Users can insert their own golf rounds" ON golf_rounds;
DROP POLICY IF EXISTS "Users can update their own golf rounds" ON golf_rounds;
DROP POLICY IF EXISTS "Users can delete their own golf rounds" ON golf_rounds;

-- RLS Policies for golf_rounds
CREATE POLICY "Users can view their own golf rounds" ON golf_rounds
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert their own golf rounds" ON golf_rounds
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update their own golf rounds" ON golf_rounds
  FOR UPDATE USING (auth.uid() = profile_id);

CREATE POLICY "Users can delete their own golf rounds" ON golf_rounds
  FOR DELETE USING (auth.uid() = profile_id);

-- =====================================================
-- 2. GOLF HOLES TABLE (for detailed hole-by-hole)
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
  fairway_hit BOOLEAN, -- NULL for par 3s
  green_in_regulation BOOLEAN,
  
  -- Optional details
  distance_yards INTEGER, -- Hole distance
  club_off_tee TEXT, -- "Driver", "3W", "5I", etc.
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  UNIQUE(round_id, hole_number)
);

-- Enable RLS on golf_holes
ALTER TABLE golf_holes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view holes for their rounds" ON golf_holes;
DROP POLICY IF EXISTS "Users can insert holes for their rounds" ON golf_holes;
DROP POLICY IF EXISTS "Users can update holes for their rounds" ON golf_holes;
DROP POLICY IF EXISTS "Users can delete holes for their rounds" ON golf_holes;

-- RLS Policies for golf_holes (through golf_rounds)
CREATE POLICY "Users can view holes for their rounds" ON golf_holes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM golf_rounds 
      WHERE golf_rounds.id = golf_holes.round_id 
      AND golf_rounds.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert holes for their rounds" ON golf_holes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM golf_rounds 
      WHERE golf_rounds.id = golf_holes.round_id 
      AND golf_rounds.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can update holes for their rounds" ON golf_holes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM golf_rounds 
      WHERE golf_rounds.id = golf_holes.round_id 
      AND golf_rounds.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete holes for their rounds" ON golf_holes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM golf_rounds 
      WHERE golf_rounds.id = golf_holes.round_id 
      AND golf_rounds.profile_id = auth.uid()
    )
  );

-- =====================================================
-- 3. UPDATE POSTS TABLE FOR GOLF INTEGRATION
-- =====================================================

-- Add golf-specific columns to posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS round_id UUID REFERENCES golf_rounds(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hole_number INTEGER CHECK (hole_number >= 1 AND hole_number <= 18);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS golf_mode TEXT CHECK (golf_mode IN ('round_recap', 'hole_highlight'));

-- Remove the old golf-specific columns that were directly in posts
ALTER TABLE posts DROP COLUMN IF EXISTS golf_course;
ALTER TABLE posts DROP COLUMN IF EXISTS golf_score;
ALTER TABLE posts DROP COLUMN IF EXISTS golf_par;
ALTER TABLE posts DROP COLUMN IF EXISTS golf_fir_percentage;
ALTER TABLE posts DROP COLUMN IF EXISTS golf_gir_percentage;
ALTER TABLE posts DROP COLUMN IF EXISTS golf_putts_per_round;
ALTER TABLE posts DROP COLUMN IF EXISTS golf_round_date;
ALTER TABLE posts DROP COLUMN IF EXISTS golf_round_notes;

-- =====================================================
-- 4. INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_golf_rounds_profile_date ON golf_rounds(profile_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_golf_rounds_course ON golf_rounds(course);
CREATE INDEX IF NOT EXISTS idx_golf_holes_round_hole ON golf_holes(round_id, hole_number);
CREATE INDEX IF NOT EXISTS idx_posts_round_id ON posts(round_id);

-- =====================================================
-- 5. FUNCTIONS FOR UPDATED_AT AND STATS
-- =====================================================

-- Add trigger for updated_at on golf_rounds
DROP TRIGGER IF EXISTS update_golf_rounds_updated_at ON golf_rounds;
CREATE TRIGGER update_golf_rounds_updated_at
    BEFORE UPDATE ON golf_rounds
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to update round completion status
CREATE OR REPLACE FUNCTION update_round_completion()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the round's completion status based on hole count
    UPDATE golf_rounds 
    SET is_complete = (
        SELECT COUNT(*) FROM golf_holes 
        WHERE round_id = COALESCE(NEW.round_id, OLD.round_id)
    ) >= (
        SELECT holes FROM golf_rounds 
        WHERE id = COALESCE(NEW.round_id, OLD.round_id)
    )
    WHERE id = COALESCE(NEW.round_id, OLD.round_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

-- Triggers to update completion status
DROP TRIGGER IF EXISTS update_completion_on_hole_insert ON golf_holes;
CREATE TRIGGER update_completion_on_hole_insert
    AFTER INSERT ON golf_holes
    FOR EACH ROW
    EXECUTE FUNCTION update_round_completion();

DROP TRIGGER IF EXISTS update_completion_on_hole_delete ON golf_holes;
CREATE TRIGGER update_completion_on_hole_delete
    AFTER DELETE ON golf_holes
    FOR EACH ROW
    EXECUTE FUNCTION update_round_completion();

-- Function to calculate round stats from holes
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
        COUNT(*) FILTER (WHERE par > 3), -- Only par 4+ count for FIR
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
        gir_percentage = CASE WHEN total_holes > 0 THEN ROUND((gir_count::decimal / total_holes) * 100, 1) ELSE gir_percentage END
    WHERE id = round_uuid;
END;
$$ language 'plpgsql';