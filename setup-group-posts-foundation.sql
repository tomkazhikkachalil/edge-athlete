-- ============================================
-- GROUP POSTS FOUNDATION - DATABASE SCHEMA
-- ============================================
-- Purpose: Generic multi-participant posts for any sport or activity
-- Features: Creator invites participants, participants attest, sport-specific data attached
-- Use Cases: Golf rounds, hockey games, volleyball matches, social events, practices
-- Architecture: Sport-agnostic core + sport-specific data tables
-- ============================================

-- ============================================
-- 1. CORE: GROUP POSTS TABLE
-- ============================================
-- Represents any multi-participant activity
-- Sport/activity-specific data lives in separate tables

CREATE TABLE IF NOT EXISTS group_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Type determines what data table is attached
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

  -- Basic information
  title TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  location TEXT,

  -- Visibility control
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'participants_only')),

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),

  -- Associated social post (auto-created when group post is published)
  post_id UUID REFERENCES posts(id) ON DELETE SET NULL,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_group_posts_creator ON group_posts(creator_id);
CREATE INDEX IF NOT EXISTS idx_group_posts_type ON group_posts(type);
CREATE INDEX IF NOT EXISTS idx_group_posts_date ON group_posts(date DESC);
CREATE INDEX IF NOT EXISTS idx_group_posts_status ON group_posts(status);
CREATE INDEX IF NOT EXISTS idx_group_posts_post ON group_posts(post_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_group_post_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_group_post_timestamp
BEFORE UPDATE ON group_posts
FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();

COMMENT ON TABLE group_posts IS 'Generic multi-participant posts for any sport or activity type';
COMMENT ON COLUMN group_posts.type IS 'Type of activity: golf_round, hockey_game, volleyball_match, etc.';
COMMENT ON COLUMN group_posts.creator_id IS 'Profile ID of the person who created/organized the activity';
COMMENT ON COLUMN group_posts.visibility IS 'Who can view this group post: public, private, or participants_only';
COMMENT ON COLUMN group_posts.status IS 'pending (draft), active (live), completed (finished), cancelled';
COMMENT ON COLUMN group_posts.post_id IS 'Associated social post in feed (auto-created on publish)';

-- ============================================
-- 2. CORE: GROUP POST PARTICIPANTS
-- ============================================
-- Represents each person in a group activity
-- Works for ANY type of group post

CREATE TABLE IF NOT EXISTS group_post_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_post_id UUID REFERENCES group_posts(id) ON DELETE CASCADE NOT NULL,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Attestation status (universal across all activity types)
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined', 'maybe')),
  attested_at TIMESTAMPTZ,

  -- Role in the activity
  role TEXT DEFAULT 'participant' CHECK (role IN (
    'creator',      -- Person who created the group post
    'participant',  -- Regular participant
    'organizer',    -- Co-organizer (can manage participants)
    'spectator'     -- Attended but didn't participate
  )),

  -- Contribution tracking
  data_contributed BOOLEAN DEFAULT FALSE, -- Has this person added their data (scores, stats, etc.)?
  last_contribution TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure each person appears only once per group post
  UNIQUE(group_post_id, profile_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_participants_group_post ON group_post_participants(group_post_id);
CREATE INDEX IF NOT EXISTS idx_participants_profile ON group_post_participants(profile_id);
CREATE INDEX IF NOT EXISTS idx_participants_status ON group_post_participants(status);
CREATE INDEX IF NOT EXISTS idx_participants_confirmed ON group_post_participants(group_post_id, status) WHERE status = 'confirmed';

-- Updated_at trigger
CREATE TRIGGER trigger_update_participant_timestamp
BEFORE UPDATE ON group_post_participants
FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();

COMMENT ON TABLE group_post_participants IS 'Participants in any group activity (sport-agnostic)';
COMMENT ON COLUMN group_post_participants.status IS 'Attestation status: pending (invited), confirmed (participating), declined, maybe';
COMMENT ON COLUMN group_post_participants.role IS 'Role in activity: creator, participant, organizer, spectator';
COMMENT ON COLUMN group_post_participants.data_contributed IS 'True when participant has added their sport-specific data (scores, stats, etc.)';

-- ============================================
-- 3. CORE: GROUP POST MEDIA
-- ============================================
-- Shared media gallery for group posts
-- Multiple participants can contribute photos/videos

CREATE TABLE IF NOT EXISTS group_post_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_post_id UUID REFERENCES group_posts(id) ON DELETE CASCADE NOT NULL,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Media details
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  caption TEXT,
  position INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_media_post ON group_post_media(group_post_id);
CREATE INDEX IF NOT EXISTS idx_group_media_uploader ON group_post_media(uploaded_by);

COMMENT ON TABLE group_post_media IS 'Shared media gallery for group posts, contributed by multiple participants';

-- ============================================
-- 4. SPORT-SPECIFIC: GOLF SCORECARD DATA
-- ============================================
-- Golf-specific data attached to group posts of type 'golf_round'

CREATE TABLE IF NOT EXISTS golf_scorecard_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_post_id UUID REFERENCES group_posts(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Course information
  course_name TEXT NOT NULL,
  course_id UUID, -- Reference to golf_courses table (no FK constraint)

  -- Round details
  round_type TEXT NOT NULL CHECK (round_type IN ('outdoor', 'indoor')),
  holes_played INTEGER NOT NULL CHECK (holes_played > 0 AND holes_played <= 18),

  -- Outdoor-specific (nullable for indoor)
  tee_color TEXT,
  slope_rating INTEGER,
  course_rating NUMERIC(4,1),

  -- Environmental conditions (outdoor only)
  weather_conditions TEXT,
  temperature INTEGER,
  wind_speed INTEGER,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()

  -- Note: Type validation (golf_round only) enforced by API and RLS policies
);

CREATE INDEX IF NOT EXISTS idx_golf_data_group_post ON golf_scorecard_data(group_post_id);
-- Note: course_id index removed since no FK constraint exists

-- Updated_at trigger
CREATE TRIGGER trigger_update_golf_data_timestamp
BEFORE UPDATE ON golf_scorecard_data
FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();

COMMENT ON TABLE golf_scorecard_data IS 'Golf-specific data for group posts of type golf_round';
COMMENT ON COLUMN golf_scorecard_data.round_type IS 'outdoor (on course) or indoor (simulator/range)';
COMMENT ON COLUMN golf_scorecard_data.holes_played IS 'Number of holes played (supports any count 1-18)';

-- ============================================
-- 5. SPORT-SPECIFIC: GOLF PARTICIPANT SCORES
-- ============================================
-- Per-participant golf scores (linked to group_post_participants)

CREATE TABLE IF NOT EXISTS golf_participant_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID REFERENCES group_post_participants(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Score entry tracking
  entered_by UUID REFERENCES profiles(id) ON DELETE SET NULL, -- Who entered these scores
  scores_confirmed BOOLEAN DEFAULT FALSE, -- Participant has confirmed their scores

  -- Aggregated totals (auto-calculated)
  total_score INTEGER,
  to_par INTEGER,
  holes_completed INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_golf_scores_participant ON golf_participant_scores(participant_id);
CREATE INDEX IF NOT EXISTS idx_golf_scores_entered_by ON golf_participant_scores(entered_by);

-- Updated_at trigger
CREATE TRIGGER trigger_update_golf_scores_timestamp
BEFORE UPDATE ON golf_participant_scores
FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();

COMMENT ON TABLE golf_participant_scores IS 'Aggregated golf scores for each participant in a golf_round group post';
COMMENT ON COLUMN golf_participant_scores.entered_by IS 'Who entered the scores: creator (pre-fill) or participant (self-entry)';
COMMENT ON COLUMN golf_participant_scores.scores_confirmed IS 'True when participant has reviewed/confirmed their scores';

-- ============================================
-- 6. SPORT-SPECIFIC: GOLF HOLE SCORES
-- ============================================
-- Per-hole detailed scores

CREATE TABLE IF NOT EXISTS golf_hole_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  golf_participant_id UUID REFERENCES golf_participant_scores(id) ON DELETE CASCADE NOT NULL,

  -- Per-hole scoring
  hole_number INTEGER NOT NULL CHECK (hole_number > 0 AND hole_number <= 18),
  strokes INTEGER NOT NULL CHECK (strokes > 0 AND strokes <= 15),
  putts INTEGER CHECK (putts IS NULL OR (putts >= 0 AND putts <= strokes)),

  -- Optional per-hole stats
  fairway_hit BOOLEAN,
  green_in_regulation BOOLEAN,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each participant can have only one score per hole
  UNIQUE(golf_participant_id, hole_number)
);

CREATE INDEX IF NOT EXISTS idx_hole_scores_participant ON golf_hole_scores(golf_participant_id);
CREATE INDEX IF NOT EXISTS idx_hole_scores_hole ON golf_hole_scores(hole_number);

-- Updated_at trigger
CREATE TRIGGER trigger_update_hole_scores_timestamp
BEFORE UPDATE ON golf_hole_scores
FOR EACH ROW EXECUTE FUNCTION update_group_post_timestamp();

COMMENT ON TABLE golf_hole_scores IS 'Per-hole detailed scores for golf participants';
COMMENT ON COLUMN golf_hole_scores.strokes IS 'Total strokes taken on this hole (1-15)';
COMMENT ON COLUMN golf_hole_scores.putts IS 'Number of putts (must be <= strokes)';

-- ============================================
-- 7. AUTO-CALCULATION TRIGGERS (GOLF)
-- ============================================
-- Automatically calculate golf totals when hole scores change

CREATE OR REPLACE FUNCTION calculate_golf_participant_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_golf_participant_id UUID;
  v_total_score INTEGER;
  v_holes_completed INTEGER;
  v_estimated_par INTEGER;
  v_to_par INTEGER;
BEGIN
  -- Get golf_participant_id from NEW or OLD (for DELETE)
  IF TG_OP = 'DELETE' THEN
    v_golf_participant_id := OLD.golf_participant_id;
  ELSE
    v_golf_participant_id := NEW.golf_participant_id;
  END IF;

  -- Calculate totals from hole scores
  SELECT
    COALESCE(SUM(strokes), 0),
    COUNT(*)
  INTO v_total_score, v_holes_completed
  FROM golf_hole_scores
  WHERE golf_participant_id = v_golf_participant_id;

  -- Estimate par (4 per hole, can be refined later with actual course data)
  v_estimated_par := v_holes_completed * 4;

  -- Calculate to-par
  IF v_holes_completed > 0 THEN
    v_to_par := v_total_score - v_estimated_par;
  ELSE
    v_to_par := NULL;
  END IF;

  -- Update aggregated scores
  UPDATE golf_participant_scores
  SET
    total_score = v_total_score,
    to_par = v_to_par,
    holes_completed = v_holes_completed,
    updated_at = NOW()
  WHERE id = v_golf_participant_id;

  -- Mark participant as having contributed data
  UPDATE group_post_participants
  SET
    data_contributed = (v_holes_completed > 0),
    last_contribution = CASE WHEN v_holes_completed > 0 THEN NOW() ELSE last_contribution END,
    updated_at = NOW()
  WHERE id = (
    SELECT participant_id FROM golf_participant_scores WHERE id = v_golf_participant_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Triggers on hole score changes
CREATE TRIGGER trigger_calculate_golf_totals_insert
AFTER INSERT ON golf_hole_scores
FOR EACH ROW EXECUTE FUNCTION calculate_golf_participant_totals();

CREATE TRIGGER trigger_calculate_golf_totals_update
AFTER UPDATE ON golf_hole_scores
FOR EACH ROW EXECUTE FUNCTION calculate_golf_participant_totals();

CREATE TRIGGER trigger_calculate_golf_totals_delete
AFTER DELETE ON golf_hole_scores
FOR EACH ROW EXECUTE FUNCTION calculate_golf_participant_totals();

-- ============================================
-- 8. ROW LEVEL SECURITY (RLS)
-- ============================================
-- Ensure proper access control for group posts

-- Enable RLS
ALTER TABLE group_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_post_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE golf_scorecard_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE golf_participant_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE golf_hole_scores ENABLE ROW LEVEL SECURITY;

-- Policy: View group posts if you're creator, participant, or if public/via public post
CREATE POLICY group_posts_select_policy ON group_posts
FOR SELECT USING (
  auth.uid() = creator_id OR
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_posts.id
    AND profile_id = auth.uid()
  ) OR
  (visibility = 'public') OR
  EXISTS (
    SELECT 1 FROM posts
    WHERE posts.id = group_posts.post_id
    AND posts.visibility = 'public'
  )
);

-- Policy: Only creator can create group posts
CREATE POLICY group_posts_insert_policy ON group_posts
FOR INSERT WITH CHECK (auth.uid() = creator_id);

-- Policy: Only creator can update their group posts
CREATE POLICY group_posts_update_policy ON group_posts
FOR UPDATE USING (auth.uid() = creator_id);

-- Policy: Only creator can delete their group posts
CREATE POLICY group_posts_delete_policy ON group_posts
FOR DELETE USING (auth.uid() = creator_id);

-- Policy: View participants if you're part of the group or creator
CREATE POLICY participants_select_policy ON group_post_participants
FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_participants.group_post_id
    AND creator_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM group_post_participants gpp
    WHERE gpp.group_post_id = group_post_participants.group_post_id
    AND gpp.profile_id = auth.uid()
  )
);

-- Policy: Creator or organizers can add participants
CREATE POLICY participants_insert_policy ON group_post_participants
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_participants.group_post_id
    AND creator_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_post_participants.group_post_id
    AND profile_id = auth.uid()
    AND role IN ('creator', 'organizer')
  )
);

-- Policy: Participants can update their own status; creator/organizers can manage all
CREATE POLICY participants_update_policy ON group_post_participants
FOR UPDATE USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_participants.group_post_id
    AND creator_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_post_participants.group_post_id
    AND profile_id = auth.uid()
    AND role IN ('creator', 'organizer')
  )
);

-- Policy: Creator/organizers can remove participants
CREATE POLICY participants_delete_policy ON group_post_participants
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_participants.group_post_id
    AND creator_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_post_participants.group_post_id
    AND profile_id = auth.uid()
    AND role IN ('creator', 'organizer')
  )
);

-- Policy: Participants can view media for their group posts
CREATE POLICY media_select_policy ON group_post_media
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_post_media.group_post_id
    AND profile_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_media.group_post_id
    AND (creator_id = auth.uid() OR visibility = 'public')
  )
);

-- Policy: Participants can upload media
CREATE POLICY media_insert_policy ON group_post_media
FOR INSERT WITH CHECK (
  auth.uid() = uploaded_by AND
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_post_media.group_post_id
    AND profile_id = auth.uid()
    AND status = 'confirmed'
  )
);

-- Policy: Uploader or creator can delete media
CREATE POLICY media_delete_policy ON group_post_media
FOR DELETE USING (
  auth.uid() = uploaded_by OR
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_media.group_post_id
    AND creator_id = auth.uid()
  )
);

-- Policy: Golf data visible to group participants
CREATE POLICY golf_data_select_policy ON golf_scorecard_data
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = golf_scorecard_data.group_post_id
    AND (
      creator_id = auth.uid() OR
      visibility = 'public' OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = golf_scorecard_data.group_post_id
        AND profile_id = auth.uid()
      )
    )
  )
);

-- Policy: Only creator can add golf data
CREATE POLICY golf_data_insert_policy ON golf_scorecard_data
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = golf_scorecard_data.group_post_id
    AND creator_id = auth.uid()
  )
);

-- Policy: Only creator can update golf data
CREATE POLICY golf_data_update_policy ON golf_scorecard_data
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = golf_scorecard_data.group_post_id
    AND creator_id = auth.uid()
  )
);

-- Policy: Golf scores visible to group participants
CREATE POLICY golf_scores_select_policy ON golf_participant_scores
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_post_participants gpp
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gpp.id = golf_participant_scores.participant_id
    AND (
      gpp.profile_id = auth.uid() OR
      gp.creator_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = gp.id
        AND profile_id = auth.uid()
      )
    )
  )
);

-- Policy: Participant or creator can add golf scores
CREATE POLICY golf_scores_insert_policy ON golf_participant_scores
FOR INSERT WITH CHECK (
  auth.uid() = entered_by AND
  EXISTS (
    SELECT 1 FROM group_post_participants gpp
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gpp.id = golf_participant_scores.participant_id
    AND (gpp.profile_id = auth.uid() OR gp.creator_id = auth.uid())
  )
);

-- Policy: Participant can update their own scores
CREATE POLICY golf_scores_update_policy ON golf_participant_scores
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE id = golf_participant_scores.participant_id
    AND profile_id = auth.uid()
  )
);

-- Policy: Hole scores visible to group participants
CREATE POLICY hole_scores_select_policy ON golf_hole_scores
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gps.id = golf_hole_scores.golf_participant_id
    AND (
      gpp.profile_id = auth.uid() OR
      gp.creator_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = gp.id
        AND profile_id = auth.uid()
      )
    )
  )
);

-- Policy: Participant or creator can add hole scores
CREATE POLICY hole_scores_insert_policy ON golf_hole_scores
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gps.id = golf_hole_scores.golf_participant_id
    AND (gpp.profile_id = auth.uid() OR gp.creator_id = auth.uid())
  )
);

-- Policy: Participant can update their own hole scores
CREATE POLICY hole_scores_update_policy ON golf_hole_scores
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    WHERE gps.id = golf_hole_scores.golf_participant_id
    AND gpp.profile_id = auth.uid()
  )
);

-- Policy: Participant or creator can delete hole scores
CREATE POLICY hole_scores_delete_policy ON golf_hole_scores
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gps.id = golf_hole_scores.golf_participant_id
    AND (gpp.profile_id = auth.uid() OR gp.creator_id = auth.uid())
  )
);

-- ============================================
-- 9. HELPER FUNCTIONS
-- ============================================

-- Function to get complete group post with all participants and data
CREATE OR REPLACE FUNCTION get_group_post_details(p_group_post_id UUID)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'group_post', (
      SELECT row_to_json(gp)
      FROM (
        SELECT
          id,
          creator_id,
          type,
          title,
          description,
          date,
          location,
          visibility,
          status,
          post_id,
          created_at,
          updated_at
        FROM group_posts
        WHERE id = p_group_post_id
      ) gp
    ),
    'participants', (
      SELECT json_agg(
        json_build_object(
          'id', gpp.id,
          'profile_id', gpp.profile_id,
          'profile', (
            SELECT row_to_json(p)
            FROM (
              SELECT id, full_name, first_name, last_name, avatar_url, sport, school
              FROM profiles
              WHERE id = gpp.profile_id
            ) p
          ),
          'status', gpp.status,
          'role', gpp.role,
          'attested_at', gpp.attested_at,
          'data_contributed', gpp.data_contributed,
          'last_contribution', gpp.last_contribution
        )
        ORDER BY gpp.created_at
      )
      FROM group_post_participants gpp
      WHERE gpp.group_post_id = p_group_post_id
    ),
    'media', (
      SELECT json_agg(
        json_build_object(
          'id', gpm.id,
          'media_url', gpm.media_url,
          'media_type', gpm.media_type,
          'caption', gpm.caption,
          'uploaded_by', gpm.uploaded_by,
          'created_at', gpm.created_at
        )
        ORDER BY gpm.position, gpm.created_at
      )
      FROM group_post_media gpm
      WHERE gpm.group_post_id = p_group_post_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_group_post_details IS 'Returns complete group post data including participants and media';

-- Function to get golf scorecard details
CREATE OR REPLACE FUNCTION get_golf_scorecard(p_group_post_id UUID)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'golf_data', (
      SELECT row_to_json(gd)
      FROM (
        SELECT
          course_name,
          round_type,
          holes_played,
          tee_color,
          slope_rating,
          course_rating,
          weather_conditions,
          temperature,
          wind_speed
        FROM golf_scorecard_data
        WHERE group_post_id = p_group_post_id
      ) gd
    ),
    'participant_scores', (
      SELECT json_agg(
        json_build_object(
          'participant_id', gpp.id,
          'profile_id', gpp.profile_id,
          'profile', (
            SELECT row_to_json(p)
            FROM (
              SELECT id, full_name, first_name, last_name, avatar_url
              FROM profiles
              WHERE id = gpp.profile_id
            ) p
          ),
          'status', gpp.status,
          'total_score', gps.total_score,
          'to_par', gps.to_par,
          'holes_completed', gps.holes_completed,
          'scores_confirmed', gps.scores_confirmed,
          'hole_scores', (
            SELECT json_object_agg(
              hole_number,
              json_build_object(
                'strokes', strokes,
                'putts', putts,
                'fairway_hit', fairway_hit,
                'green_in_regulation', green_in_regulation
              )
            )
            FROM golf_hole_scores
            WHERE golf_participant_id = gps.id
            ORDER BY hole_number
          )
        )
        ORDER BY gpp.created_at
      )
      FROM group_post_participants gpp
      LEFT JOIN golf_participant_scores gps ON gps.participant_id = gpp.id
      WHERE gpp.group_post_id = p_group_post_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_golf_scorecard IS 'Returns complete golf scorecard with all participants and hole-by-hole scores';

-- ============================================
-- 10. PLACEHOLDER TABLES FOR FUTURE SPORTS
-- ============================================
-- These are intentionally empty - add fields when implementing each sport

-- Hockey game data (future)
CREATE TABLE IF NOT EXISTS hockey_game_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_post_id UUID REFERENCES group_posts(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- TODO: Add hockey-specific fields when implementing
  -- venue TEXT,
  -- game_type TEXT, -- 'regular', 'playoff', 'tournament'
  -- periods INTEGER DEFAULT 3,
  -- overtime_type TEXT, -- 'sudden_death', '4v4', '3v3'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE hockey_game_data IS 'Hockey-specific data for group posts of type hockey_game (placeholder for future implementation)';

-- Volleyball match data (future)
CREATE TABLE IF NOT EXISTS volleyball_match_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_post_id UUID REFERENCES group_posts(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- TODO: Add volleyball-specific fields when implementing
  -- match_format TEXT, -- 'indoor', 'beach', 'grass'
  -- sets_to_win INTEGER DEFAULT 3,
  -- points_per_set INTEGER DEFAULT 25,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE volleyball_match_data IS 'Volleyball-specific data for group posts of type volleyball_match (placeholder for future implementation)';

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT 'Group posts foundation created successfully! Golf scorecard ready, other sports ready to implement.' AS status;
