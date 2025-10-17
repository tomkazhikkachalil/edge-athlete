-- ============================================================
-- Flexible Golf Rounds Update
-- ============================================================
-- This migration adds support for:
-- 1. Flexible number of holes (not just 9 or 18)
-- 2. Indoor golf rounds
-- ============================================================

-- Remove the CHECK constraint that limits holes to 9 or 18
ALTER TABLE golf_rounds
DROP CONSTRAINT IF EXISTS golf_rounds_holes_check;

-- Add round_type column for indoor/outdoor golf
ALTER TABLE golf_rounds
ADD COLUMN IF NOT EXISTS round_type TEXT DEFAULT 'outdoor' CHECK (round_type IN ('outdoor', 'indoor'));

-- Add index for round_type for filtering
CREATE INDEX IF NOT EXISTS idx_golf_rounds_round_type
ON golf_rounds(round_type);

-- Add comment to document the change
COMMENT ON COLUMN golf_rounds.holes IS 'Number of holes played - can be any positive integer (commonly 9 or 18, but supports partial rounds like 5, 12, 15, etc.)';
COMMENT ON COLUMN golf_rounds.round_type IS 'Type of round: outdoor (default) or indoor (simulator/range)';

-- Update existing records to have 'outdoor' as round_type (if column was just added)
UPDATE golf_rounds
SET round_type = 'outdoor'
WHERE round_type IS NULL;
