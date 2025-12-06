-- ============================================
-- SHARED GOLF ROUNDS - DATABASE MIGRATION
-- ============================================
-- Purpose: Enable multi-participant golf rounds with shared scorecards
-- Date: 2025-01-XX
-- ============================================

-- ============================================
-- STEP 1: Create group_posts foundation (if not exists)
-- ============================================
-- This section is from 004_group_posts.sql
-- Safe to run multiple times due to IF NOT EXISTS

-- Core group posts table
CREATE TABLE IF NOT EXISTS group_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  type TEXT NOT NULL CHECK (type IN (
    'golf_round',
    'hockey_game',
    'volleyball_match',
    'basketball_game',
    'social_event',
    'practice_session',
    'tournament_round',
    'watch_party'
  )),

  title TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  location TEXT,

  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'participants_only')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),

  post_id UUID REFERENCES posts(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Participants junction table
CREATE TABLE IF NOT EXISTS group_post_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_post_id UUID REFERENCES group_posts(id) ON DELETE CASCADE NOT NULL,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined', 'maybe')),
  role TEXT DEFAULT 'participant' CHECK (role IN ('creator', 'participant', 'organizer', 'spectator')),

  attested_at TIMESTAMPTZ,
  data_contributed BOOLEAN DEFAULT FALSE,
  last_contribution TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(group_post_id, profile_id)
);

-- Shared media gallery (all participants can upload)
CREATE TABLE IF NOT EXISTS group_post_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_post_id UUID REFERENCES group_posts(id) ON DELETE CASCADE NOT NULL,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  caption TEXT,
  position INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Golf-specific scorecard data
CREATE TABLE IF NOT EXISTS golf_scorecard_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_post_id UUID REFERENCES group_posts(id) ON DELETE CASCADE NOT NULL UNIQUE,

  course_name TEXT NOT NULL,
  course_id TEXT,
  round_type TEXT CHECK (round_type IN ('outdoor', 'indoor')),
  holes_played INTEGER CHECK (holes_played BETWEEN 1 AND 18),
  tee_color TEXT,
  slope_rating NUMERIC(5,1),
  course_rating NUMERIC(5,1),
  weather_conditions TEXT,
  temperature INTEGER,
  wind_speed INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-participant aggregated scores
CREATE TABLE IF NOT EXISTS golf_participant_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID REFERENCES group_post_participants(id) ON DELETE CASCADE NOT NULL UNIQUE,

  entered_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  scores_confirmed BOOLEAN DEFAULT FALSE,

  total_score INTEGER,
  to_par INTEGER,
  holes_completed INTEGER DEFAULT 0,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hole-by-hole scoring
CREATE TABLE IF NOT EXISTS golf_hole_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  golf_participant_id UUID REFERENCES golf_participant_scores(id) ON DELETE CASCADE NOT NULL,

  hole_number INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  strokes INTEGER NOT NULL CHECK (strokes > 0),
  putts INTEGER CHECK (putts >= 0),
  fairway_hit BOOLEAN,
  green_in_regulation BOOLEAN,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(golf_participant_id, hole_number)
);

-- ============================================
-- STEP 2: Create indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_group_posts_creator ON group_posts(creator_id);
CREATE INDEX IF NOT EXISTS idx_group_posts_type ON group_posts(type);
CREATE INDEX IF NOT EXISTS idx_group_posts_date ON group_posts(date);
CREATE INDEX IF NOT EXISTS idx_group_posts_status ON group_posts(status);

CREATE INDEX IF NOT EXISTS idx_group_post_participants_group ON group_post_participants(group_post_id);
CREATE INDEX IF NOT EXISTS idx_group_post_participants_profile ON group_post_participants(profile_id);
CREATE INDEX IF NOT EXISTS idx_group_post_participants_status ON group_post_participants(status);

CREATE INDEX IF NOT EXISTS idx_group_post_media_group ON group_post_media(group_post_id);
CREATE INDEX IF NOT EXISTS idx_group_post_media_uploader ON group_post_media(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_golf_scorecard_group ON golf_scorecard_data(group_post_id);
CREATE INDEX IF NOT EXISTS idx_golf_participant_scores_participant ON golf_participant_scores(participant_id);
CREATE INDEX IF NOT EXISTS idx_golf_hole_scores_participant ON golf_hole_scores(golf_participant_id);

-- ============================================
-- STEP 3: Add group_post_id to posts table
-- ============================================

-- Add the linking column
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS group_post_id UUID
  REFERENCES group_posts(id) ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_posts_group_post_id
  ON posts(group_post_id);

-- Prevent a post from being both an individual round AND a shared round
-- (A post can have either round_id OR group_post_id, but not both)
ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS check_golf_sources;

ALTER TABLE posts
  ADD CONSTRAINT check_golf_sources
  CHECK (NOT (round_id IS NOT NULL AND group_post_id IS NOT NULL));

-- ============================================
-- STEP 4: Create auto-calculation triggers
-- ============================================

-- Auto-calculate participant totals when hole scores change
CREATE OR REPLACE FUNCTION calculate_golf_participant_totals()
RETURNS TRIGGER AS $$
DECLARE
  participant_record RECORD;
  holes_count INTEGER;
  score_sum INTEGER;
  estimated_par INTEGER;
BEGIN
  -- Get the participant record
  SELECT id, participant_id INTO participant_record
  FROM golf_participant_scores
  WHERE id = COALESCE(NEW.golf_participant_id, OLD.golf_participant_id);

  -- Calculate stats from hole scores
  SELECT
    COUNT(*),
    COALESCE(SUM(strokes), 0)
  INTO
    holes_count,
    score_sum
  FROM golf_hole_scores
  WHERE golf_participant_id = participant_record.id;

  -- Estimate par (assume par 4 for each hole)
  estimated_par := holes_count * 4;

  -- Update the participant scores record
  UPDATE golf_participant_scores
  SET
    total_score = score_sum,
    to_par = score_sum - estimated_par,
    holes_completed = holes_count,
    updated_at = NOW()
  WHERE id = participant_record.id;

  -- Mark participant as having contributed data
  UPDATE group_post_participants
  SET
    data_contributed = TRUE,
    last_contribution = NOW()
  WHERE id = participant_record.participant_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger on INSERT/UPDATE/DELETE of hole scores
DROP TRIGGER IF EXISTS trigger_calculate_golf_totals_insert ON golf_hole_scores;
CREATE TRIGGER trigger_calculate_golf_totals_insert
AFTER INSERT ON golf_hole_scores
FOR EACH ROW EXECUTE FUNCTION calculate_golf_participant_totals();

DROP TRIGGER IF EXISTS trigger_calculate_golf_totals_update ON golf_hole_scores;
CREATE TRIGGER trigger_calculate_golf_totals_update
AFTER UPDATE ON golf_hole_scores
FOR EACH ROW EXECUTE FUNCTION calculate_golf_participant_totals();

DROP TRIGGER IF EXISTS trigger_calculate_golf_totals_delete ON golf_hole_scores;
CREATE TRIGGER trigger_calculate_golf_totals_delete
AFTER DELETE ON golf_hole_scores
FOR EACH ROW EXECUTE FUNCTION calculate_golf_participant_totals();

-- Updated_at trigger for group_posts
DROP TRIGGER IF EXISTS trigger_group_posts_updated_at ON group_posts;
CREATE TRIGGER trigger_group_posts_updated_at
BEFORE UPDATE ON group_posts
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================
-- STEP 5: Row Level Security (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE group_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_post_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE golf_scorecard_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE golf_participant_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE golf_hole_scores ENABLE ROW LEVEL SECURITY;

-- GROUP POSTS POLICIES
DROP POLICY IF EXISTS group_posts_select_policy ON group_posts;
CREATE POLICY group_posts_select_policy ON group_posts
FOR SELECT USING (
  visibility = 'public' OR
  creator_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_posts.id
    AND profile_id = auth.uid()
  )
);

DROP POLICY IF EXISTS group_posts_insert_policy ON group_posts;
CREATE POLICY group_posts_insert_policy ON group_posts
FOR INSERT WITH CHECK (creator_id = auth.uid());

DROP POLICY IF EXISTS group_posts_update_policy ON group_posts;
CREATE POLICY group_posts_update_policy ON group_posts
FOR UPDATE USING (creator_id = auth.uid());

DROP POLICY IF EXISTS group_posts_delete_policy ON group_posts;
CREATE POLICY group_posts_delete_policy ON group_posts
FOR DELETE USING (creator_id = auth.uid());

-- PARTICIPANTS POLICIES
DROP POLICY IF EXISTS participants_select_policy ON group_post_participants;
CREATE POLICY participants_select_policy ON group_post_participants
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_participants.group_post_id
    AND (
      visibility = 'public' OR
      creator_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM group_post_participants gpp
        WHERE gpp.group_post_id = group_posts.id
        AND gpp.profile_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS participants_insert_policy ON group_post_participants;
CREATE POLICY participants_insert_policy ON group_post_participants
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_id
    AND (creator_id = auth.uid() OR
         EXISTS (SELECT 1 FROM group_post_participants WHERE group_post_id = group_posts.id AND profile_id = auth.uid() AND role = 'organizer'))
  )
);

DROP POLICY IF EXISTS participants_update_policy ON group_post_participants;
CREATE POLICY participants_update_policy ON group_post_participants
FOR UPDATE USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_id
    AND creator_id = auth.uid()
  )
);

DROP POLICY IF EXISTS participants_delete_policy ON group_post_participants;
CREATE POLICY participants_delete_policy ON group_post_participants
FOR DELETE USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_id
    AND creator_id = auth.uid()
  )
);

-- MEDIA POLICIES
DROP POLICY IF EXISTS media_select_policy ON group_post_media;
CREATE POLICY media_select_policy ON group_post_media
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_media.group_post_id
    AND (
      visibility = 'public' OR
      creator_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = group_posts.id
        AND profile_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS media_insert_policy ON group_post_media;
CREATE POLICY media_insert_policy ON group_post_media
FOR INSERT WITH CHECK (
  uploaded_by = auth.uid() AND
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_post_media.group_post_id
    AND profile_id = auth.uid()
    AND status = 'confirmed'
  )
);

DROP POLICY IF EXISTS media_delete_policy ON group_post_media;
CREATE POLICY media_delete_policy ON group_post_media
FOR DELETE USING (
  uploaded_by = auth.uid() OR
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_media.group_post_id
    AND creator_id = auth.uid()
  )
);

-- GOLF SCORECARD DATA POLICIES
DROP POLICY IF EXISTS scorecard_select_policy ON golf_scorecard_data;
CREATE POLICY scorecard_select_policy ON golf_scorecard_data
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = golf_scorecard_data.group_post_id
    AND (
      visibility = 'public' OR
      creator_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = group_posts.id
        AND profile_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS scorecard_insert_policy ON golf_scorecard_data;
CREATE POLICY scorecard_insert_policy ON golf_scorecard_data
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_id
    AND creator_id = auth.uid()
  )
);

DROP POLICY IF EXISTS scorecard_update_policy ON golf_scorecard_data;
CREATE POLICY scorecard_update_policy ON golf_scorecard_data
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_id
    AND creator_id = auth.uid()
  )
);

-- PARTICIPANT SCORES POLICIES
DROP POLICY IF EXISTS participant_scores_select_policy ON golf_participant_scores;
CREATE POLICY participant_scores_select_policy ON golf_participant_scores
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_post_participants gpp
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gpp.id = golf_participant_scores.participant_id
    AND (
      gp.visibility = 'public' OR
      gp.creator_id = auth.uid() OR
      gpp.profile_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = gp.id
        AND profile_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS participant_scores_insert_policy ON golf_participant_scores;
CREATE POLICY participant_scores_insert_policy ON golf_participant_scores
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_post_participants gpp
    WHERE gpp.id = participant_id
    AND gpp.profile_id = auth.uid()
  )
);

DROP POLICY IF EXISTS participant_scores_update_policy ON golf_participant_scores;
CREATE POLICY participant_scores_update_policy ON golf_participant_scores
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_post_participants gpp
    WHERE gpp.id = participant_id
    AND (
      gpp.profile_id = auth.uid() OR
      EXISTS (SELECT 1 FROM group_posts WHERE id = gpp.group_post_id AND creator_id = auth.uid())
    )
  )
);

-- HOLE SCORES POLICIES
DROP POLICY IF EXISTS hole_scores_select_policy ON golf_hole_scores;
CREATE POLICY hole_scores_select_policy ON golf_hole_scores
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gps.id = golf_hole_scores.golf_participant_id
    AND (
      gp.visibility = 'public' OR
      gp.creator_id = auth.uid() OR
      gpp.profile_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = gp.id
        AND profile_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS hole_scores_insert_policy ON golf_hole_scores;
CREATE POLICY hole_scores_insert_policy ON golf_hole_scores
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    WHERE gps.id = golf_participant_id
    AND (
      gpp.profile_id = auth.uid() OR
      gps.entered_by = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS hole_scores_update_policy ON golf_hole_scores;
CREATE POLICY hole_scores_update_policy ON golf_hole_scores
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    WHERE gps.id = golf_participant_id
    AND (
      gpp.profile_id = auth.uid() OR
      gps.entered_by = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS hole_scores_delete_policy ON golf_hole_scores;
CREATE POLICY hole_scores_delete_policy ON golf_hole_scores
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    WHERE gps.id = golf_participant_id
    AND (
      gpp.profile_id = auth.uid() OR
      EXISTS (SELECT 1 FROM group_posts WHERE id = gpp.group_post_id AND creator_id = auth.uid())
    )
  )
);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check all tables were created
DO $$
BEGIN
  RAISE NOTICE '=== VERIFICATION ===';
  RAISE NOTICE 'group_posts table exists: %',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_posts'));
  RAISE NOTICE 'group_post_participants table exists: %',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_post_participants'));
  RAISE NOTICE 'group_post_media table exists: %',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_post_media'));
  RAISE NOTICE 'golf_scorecard_data table exists: %',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'golf_scorecard_data'));
  RAISE NOTICE 'golf_participant_scores table exists: %',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'golf_participant_scores'));
  RAISE NOTICE 'golf_hole_scores table exists: %',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'golf_hole_scores'));
  RAISE NOTICE 'posts.group_post_id column exists: %',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'group_post_id'));
  RAISE NOTICE '=== MIGRATION COMPLETE ===';
END $$;
