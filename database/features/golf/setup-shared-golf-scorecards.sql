-- ============================================
-- SHARED GOLF SCORECARDS - DATABASE SCHEMA
-- ============================================
-- Purpose: Enable multi-player golf scorecards with participant attestation
-- Features: Owner creates round, participants confirm and add their own scores
-- Supports: Any hole count (5, 9, 12, 18), Indoor/Outdoor, Partial rounds
-- ============================================

-- ============================================
-- 1. SHARED GOLF ROUNDS TABLE
-- ============================================
-- Represents a single round that multiple golfers participated in
-- Owner creates the round and can pre-fill scores

CREATE TABLE IF NOT EXISTS shared_golf_rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Round details
  course_name TEXT NOT NULL,
  course_id UUID REFERENCES golf_courses(id) ON DELETE SET NULL,
  round_type TEXT NOT NULL CHECK (round_type IN ('outdoor', 'indoor')),
  date DATE NOT NULL,
  holes_played INTEGER NOT NULL CHECK (holes_played > 0 AND holes_played <= 18),

  -- Outdoor-specific (nullable for indoor)
  tee_color TEXT,
  slope_rating INTEGER,
  course_rating NUMERIC(4,1),

  -- Environmental conditions (outdoor only)
  weather_conditions TEXT,
  temperature INTEGER,
  wind_speed INTEGER,

  -- Post association
  post_id UUID REFERENCES posts(id) ON DELETE SET NULL,

  -- Status tracking
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shared_rounds_owner ON shared_golf_rounds(owner_id);
CREATE INDEX IF NOT EXISTS idx_shared_rounds_post ON shared_golf_rounds(post_id);
CREATE INDEX IF NOT EXISTS idx_shared_rounds_date ON shared_golf_rounds(date DESC);
CREATE INDEX IF NOT EXISTS idx_shared_rounds_status ON shared_golf_rounds(status);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_shared_round_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_shared_round_timestamp
BEFORE UPDATE ON shared_golf_rounds
FOR EACH ROW EXECUTE FUNCTION update_shared_round_timestamp();

COMMENT ON TABLE shared_golf_rounds IS 'Shared golf rounds where multiple players participate';
COMMENT ON COLUMN shared_golf_rounds.owner_id IS 'Profile ID of the player who created the round';
COMMENT ON COLUMN shared_golf_rounds.round_type IS 'outdoor (on course) or indoor (simulator/range)';
COMMENT ON COLUMN shared_golf_rounds.holes_played IS 'Number of holes played (supports any count 1-18)';
COMMENT ON COLUMN shared_golf_rounds.post_id IS 'Associated social post showing the scorecard';

-- ============================================
-- 2. SHARED ROUND PARTICIPANTS TABLE
-- ============================================
-- Represents each player in a shared round
-- Tracks attestation status and aggregated scores

CREATE TABLE IF NOT EXISTS shared_round_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID REFERENCES shared_golf_rounds(id) ON DELETE CASCADE NOT NULL,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Attestation status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined')),
  attested_at TIMESTAMPTZ,

  -- Score entry tracking
  scores_entered_by TEXT CHECK (scores_entered_by IN ('owner', 'participant')),
  scores_confirmed BOOLEAN DEFAULT FALSE,
  last_score_update TIMESTAMPTZ,

  -- Aggregated scores (auto-calculated by triggers)
  total_score INTEGER,
  to_par INTEGER,
  holes_completed INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure each player appears only once per round
  UNIQUE(round_id, profile_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_participants_round ON shared_round_participants(round_id);
CREATE INDEX IF NOT EXISTS idx_participants_profile ON shared_round_participants(profile_id);
CREATE INDEX IF NOT EXISTS idx_participants_status ON shared_round_participants(status);
CREATE INDEX IF NOT EXISTS idx_participants_confirmed ON shared_round_participants(round_id, status) WHERE status = 'confirmed';

-- Updated_at trigger
CREATE TRIGGER trigger_update_participant_timestamp
BEFORE UPDATE ON shared_round_participants
FOR EACH ROW EXECUTE FUNCTION update_shared_round_timestamp();

COMMENT ON TABLE shared_round_participants IS 'Players participating in a shared golf round';
COMMENT ON COLUMN shared_round_participants.status IS 'pending (invited), confirmed (attested), declined (not playing)';
COMMENT ON COLUMN shared_round_participants.scores_entered_by IS 'Who entered the scores: owner (pre-fill) or participant (self-entry)';
COMMENT ON COLUMN shared_round_participants.scores_confirmed IS 'True when participant has reviewed/confirmed their scores';
COMMENT ON COLUMN shared_round_participants.total_score IS 'Auto-calculated total strokes';
COMMENT ON COLUMN shared_round_participants.to_par IS 'Auto-calculated score relative to par';
COMMENT ON COLUMN shared_round_participants.holes_completed IS 'Number of holes with entered scores';

-- ============================================
-- 3. SHARED ROUND SCORES TABLE
-- ============================================
-- Stores per-hole scores for each participant
-- One row per hole per participant

CREATE TABLE IF NOT EXISTS shared_round_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID REFERENCES shared_round_participants(id) ON DELETE CASCADE NOT NULL,

  -- Per-hole scoring
  hole_number INTEGER NOT NULL CHECK (hole_number > 0 AND hole_number <= 18),
  strokes INTEGER NOT NULL CHECK (strokes > 0 AND strokes <= 15),
  putts INTEGER CHECK (putts IS NULL OR (putts >= 0 AND putts <= strokes)),

  -- Optional per-hole stats
  fairway_hit BOOLEAN,
  green_in_regulation BOOLEAN,

  -- Tracking
  entered_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each participant can have only one score per hole
  UNIQUE(participant_id, hole_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scores_participant ON shared_round_scores(participant_id);
CREATE INDEX IF NOT EXISTS idx_scores_hole ON shared_round_scores(hole_number);

-- Updated_at trigger
CREATE TRIGGER trigger_update_score_timestamp
BEFORE UPDATE ON shared_round_scores
FOR EACH ROW EXECUTE FUNCTION update_shared_round_timestamp();

COMMENT ON TABLE shared_round_scores IS 'Per-hole scores for shared round participants';
COMMENT ON COLUMN shared_round_scores.strokes IS 'Total strokes taken on this hole';
COMMENT ON COLUMN shared_round_scores.putts IS 'Number of putts (must be <= strokes)';
COMMENT ON COLUMN shared_round_scores.entered_by IS 'Profile ID who entered this score (owner or participant)';

-- ============================================
-- 4. AUTO-CALCULATION TRIGGERS
-- ============================================
-- Automatically calculate totals when scores are added/updated/deleted

-- Function to calculate participant totals and to-par
CREATE OR REPLACE FUNCTION calculate_participant_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_participant_id UUID;
  v_round_id UUID;
  v_total_score INTEGER;
  v_holes_completed INTEGER;
  v_course_par INTEGER;
  v_to_par INTEGER;
BEGIN
  -- Get participant_id from NEW or OLD (for DELETE)
  IF TG_OP = 'DELETE' THEN
    v_participant_id := OLD.participant_id;
  ELSE
    v_participant_id := NEW.participant_id;
  END IF;

  -- Calculate totals from scores
  SELECT
    COALESCE(SUM(strokes), 0),
    COUNT(*)
  INTO v_total_score, v_holes_completed
  FROM shared_round_scores
  WHERE participant_id = v_participant_id;

  -- Get round details to calculate par
  SELECT sgr.id, sgr.holes_played * 4 -- Estimate par as 4 per hole (can be refined)
  INTO v_round_id, v_course_par
  FROM shared_round_participants srp
  JOIN shared_golf_rounds sgr ON srp.round_id = sgr.id
  WHERE srp.id = v_participant_id;

  -- Calculate to-par (only if we have complete round data)
  IF v_holes_completed > 0 THEN
    -- For partial rounds, estimate par proportionally
    v_to_par := v_total_score - (v_course_par * v_holes_completed / (SELECT holes_played FROM shared_golf_rounds WHERE id = v_round_id));
  ELSE
    v_to_par := NULL;
  END IF;

  -- Update participant record
  UPDATE shared_round_participants
  SET
    total_score = v_total_score,
    to_par = v_to_par,
    holes_completed = v_holes_completed,
    last_score_update = NOW(),
    updated_at = NOW()
  WHERE id = v_participant_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Triggers on score changes
CREATE TRIGGER trigger_calculate_totals_insert
AFTER INSERT ON shared_round_scores
FOR EACH ROW EXECUTE FUNCTION calculate_participant_totals();

CREATE TRIGGER trigger_calculate_totals_update
AFTER UPDATE ON shared_round_scores
FOR EACH ROW EXECUTE FUNCTION calculate_participant_totals();

CREATE TRIGGER trigger_calculate_totals_delete
AFTER DELETE ON shared_round_scores
FOR EACH ROW EXECUTE FUNCTION calculate_participant_totals();

-- ============================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================
-- Ensure proper access control for shared rounds

-- Enable RLS
ALTER TABLE shared_golf_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_round_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_round_scores ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view shared rounds they own or participate in
CREATE POLICY shared_rounds_select_policy ON shared_golf_rounds
FOR SELECT USING (
  auth.uid() = owner_id OR
  EXISTS (
    SELECT 1 FROM shared_round_participants
    WHERE round_id = shared_golf_rounds.id
    AND profile_id = auth.uid()
  ) OR
  -- Public rounds (via public posts)
  EXISTS (
    SELECT 1 FROM posts
    WHERE posts.id = shared_golf_rounds.post_id
    AND posts.visibility = 'public'
  )
);

-- Policy: Only owners can create shared rounds
CREATE POLICY shared_rounds_insert_policy ON shared_golf_rounds
FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- Policy: Only owners can update their rounds
CREATE POLICY shared_rounds_update_policy ON shared_golf_rounds
FOR UPDATE USING (auth.uid() = owner_id);

-- Policy: Only owners can delete their rounds
CREATE POLICY shared_rounds_delete_policy ON shared_golf_rounds
FOR DELETE USING (auth.uid() = owner_id);

-- Policy: Participants can view their participation record
CREATE POLICY participants_select_policy ON shared_round_participants
FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM shared_golf_rounds
    WHERE id = shared_round_participants.round_id
    AND owner_id = auth.uid()
  )
);

-- Policy: Owners can add participants
CREATE POLICY participants_insert_policy ON shared_round_participants
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM shared_golf_rounds
    WHERE id = shared_round_participants.round_id
    AND owner_id = auth.uid()
  )
);

-- Policy: Participants can update their own status; owners can manage all
CREATE POLICY participants_update_policy ON shared_round_participants
FOR UPDATE USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM shared_golf_rounds
    WHERE id = shared_round_participants.round_id
    AND owner_id = auth.uid()
  )
);

-- Policy: Owners can remove participants
CREATE POLICY participants_delete_policy ON shared_round_participants
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM shared_golf_rounds
    WHERE id = shared_round_participants.round_id
    AND owner_id = auth.uid()
  )
);

-- Policy: Users can view scores for rounds they're part of
CREATE POLICY scores_select_policy ON shared_round_scores
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM shared_round_participants srp
    JOIN shared_golf_rounds sgr ON srp.round_id = sgr.id
    WHERE srp.id = shared_round_scores.participant_id
    AND (
      srp.profile_id = auth.uid() OR
      sgr.owner_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM shared_round_participants
        WHERE round_id = sgr.id AND profile_id = auth.uid()
      )
    )
  )
);

-- Policy: Owners and participants can add scores
CREATE POLICY scores_insert_policy ON shared_round_scores
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM shared_round_participants srp
    JOIN shared_golf_rounds sgr ON srp.round_id = sgr.id
    WHERE srp.id = shared_round_scores.participant_id
    AND (
      -- Participant adding their own scores
      (srp.profile_id = auth.uid() AND entered_by = auth.uid()) OR
      -- Owner pre-filling scores
      (sgr.owner_id = auth.uid() AND entered_by = auth.uid())
    )
  )
);

-- Policy: Only the participant can edit their own scores (after confirmation)
CREATE POLICY scores_update_policy ON shared_round_scores
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM shared_round_participants srp
    WHERE srp.id = shared_round_scores.participant_id
    AND srp.profile_id = auth.uid()
  )
);

-- Policy: Participant or owner can delete scores
CREATE POLICY scores_delete_policy ON shared_round_scores
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM shared_round_participants srp
    JOIN shared_golf_rounds sgr ON srp.round_id = sgr.id
    WHERE srp.id = shared_round_scores.participant_id
    AND (
      srp.profile_id = auth.uid() OR
      sgr.owner_id = auth.uid()
    )
  )
);

-- ============================================
-- 6. HELPER FUNCTIONS
-- ============================================

-- Function to get full scorecard data for a round
CREATE OR REPLACE FUNCTION get_shared_round_scorecard(p_round_id UUID)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'round', (
      SELECT row_to_json(r)
      FROM (
        SELECT
          id,
          owner_id,
          course_name,
          round_type,
          date,
          holes_played,
          tee_color,
          weather_conditions,
          temperature,
          post_id,
          status,
          created_at
        FROM shared_golf_rounds
        WHERE id = p_round_id
      ) r
    ),
    'participants', (
      SELECT json_agg(
        json_build_object(
          'id', srp.id,
          'profile_id', srp.profile_id,
          'profile', (
            SELECT row_to_json(p)
            FROM (
              SELECT id, full_name, first_name, last_name, avatar_url, sport, school
              FROM profiles
              WHERE id = srp.profile_id
            ) p
          ),
          'status', srp.status,
          'attested_at', srp.attested_at,
          'scores_entered_by', srp.scores_entered_by,
          'scores_confirmed', srp.scores_confirmed,
          'total_score', srp.total_score,
          'to_par', srp.to_par,
          'holes_completed', srp.holes_completed,
          'scores', (
            SELECT json_object_agg(hole_number, json_build_object(
              'strokes', strokes,
              'putts', putts,
              'fairway_hit', fairway_hit,
              'green_in_regulation', green_in_regulation
            ))
            FROM shared_round_scores
            WHERE participant_id = srp.id
            ORDER BY hole_number
          )
        )
        ORDER BY srp.created_at
      )
      FROM shared_round_participants srp
      WHERE srp.round_id = p_round_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_shared_round_scorecard IS 'Returns complete scorecard data for a shared round including all participants and scores';

-- ============================================
-- 7. SAMPLE DATA (OPTIONAL - FOR TESTING)
-- ============================================

-- Uncomment to insert sample data for testing
/*
-- Insert a test shared round
INSERT INTO shared_golf_rounds (
  owner_id,
  course_name,
  round_type,
  date,
  holes_played,
  tee_color,
  status
) VALUES (
  (SELECT id FROM profiles LIMIT 1), -- Replace with actual profile ID
  'Pebble Beach Golf Links',
  'outdoor',
  '2025-01-15',
  18,
  'white',
  'active'
);
*/

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT 'Shared golf scorecards schema created successfully!' AS status;
