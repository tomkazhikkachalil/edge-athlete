-- Add league_tags column to season_highlights table
-- This enables storing league affiliations directly with season data

ALTER TABLE season_highlights 
ADD COLUMN league_tags TEXT[];

-- Add some sample data to demonstrate the feature
-- (These can be removed in production)

-- Sample Ice Hockey data
UPDATE season_highlights 
SET league_tags = '{"NCAA D1", "Big Ten"}'::TEXT[]
WHERE sport_key = 'ice_hockey' AND league_tags IS NULL;

-- Sample Volleyball data  
UPDATE season_highlights 
SET league_tags = '{"USAV", "NCAA D2"}'::TEXT[]
WHERE sport_key = 'volleyball' AND league_tags IS NULL;

-- Sample Track & Field data
UPDATE season_highlights 
SET league_tags = '{"USATF", "NCAA D1"}'::TEXT[]  
WHERE sport_key = 'track_field' AND league_tags IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN season_highlights.league_tags IS 'Array of league affiliations for this sport/season (e.g., ["NCAA D1", "Big Ten"])';