-- =====================================================
-- ADD FUTURE SPORT COLUMNS TO POSTS TABLE
-- =====================================================
-- This prepares the posts table for multiple sports by adding
-- foreign key columns for different sport-specific data.
--
-- Current: round_id (golf)
-- Adding: game_id (basketball, hockey, football, baseball)
--         match_id (soccer, tennis, volleyball)
--         race_id (track & field, swimming)
--
-- Run this in Supabase SQL Editor
-- =====================================================

-- Add game_id column for team sports with games
-- (basketball, ice hockey, football, baseball)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS game_id UUID;

-- Add match_id column for match-based sports
-- (soccer, tennis, volleyball)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS match_id UUID;

-- Add race_id column for timed/racing sports
-- (track & field, swimming)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS race_id UUID;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_posts_game_id ON posts(game_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_match_id ON posts(match_id) WHERE match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_race_id ON posts(race_id) WHERE race_id IS NOT NULL;

-- Update the composite stats media index to include new columns
DROP INDEX IF EXISTS idx_posts_stats_media;

CREATE INDEX IF NOT EXISTS idx_posts_stats_media
ON posts(profile_id, created_at DESC)
WHERE (
  (stats_data IS NOT NULL AND stats_data != '{}'::jsonb)
  OR round_id IS NOT NULL
  OR game_id IS NOT NULL
  OR match_id IS NOT NULL
  OR race_id IS NOT NULL
);

-- Note: Foreign key constraints will be added when respective
-- sport-specific tables are created (games, matches, races)
-- For example:
-- ALTER TABLE posts ADD CONSTRAINT fk_posts_game_id
--   FOREIGN KEY (game_id) REFERENCES basketball_games(id) ON DELETE SET NULL;

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    FUTURE SPORT COLUMNS ADDED TO POSTS';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'New columns added:';
  RAISE NOTICE '  ✓ game_id - For basketball, ice hockey, football, baseball';
  RAISE NOTICE '  ✓ match_id - For soccer, tennis, volleyball';
  RAISE NOTICE '  ✓ race_id - For track & field, swimming';
  RAISE NOTICE '';
  RAISE NOTICE 'Indexes created:';
  RAISE NOTICE '  ✓ idx_posts_game_id';
  RAISE NOTICE '  ✓ idx_posts_match_id';
  RAISE NOTICE '  ✓ idx_posts_race_id';
  RAISE NOTICE '  ✓ idx_posts_stats_media (updated)';
  RAISE NOTICE '';
  RAISE NOTICE 'Sport-specific tables to create in future:';
  RAISE NOTICE '  • basketball_games, hockey_games, football_games, baseball_games';
  RAISE NOTICE '  • soccer_matches, tennis_matches, volleyball_matches';
  RAISE NOTICE '  • track_races, swim_races';
  RAISE NOTICE '';
  RAISE NOTICE 'After creating sport tables, add foreign key constraints:';
  RAISE NOTICE '  ALTER TABLE posts ADD CONSTRAINT fk_posts_game_id';
  RAISE NOTICE '    FOREIGN KEY (game_id) REFERENCES [sport]_games(id) ON DELETE SET NULL;';
  RAISE NOTICE '';
END $$;
