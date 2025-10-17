-- =====================================================
-- ADD GOLF ROUND CONDITIONS & COURSE DIFFICULTY FIELDS
-- =====================================================
-- Adds weather conditions, temperature, wind, and course rating/slope
-- to the golf_rounds table for complete round context
-- Run this in Supabase SQL Editor

-- Add weather conditions columns
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS weather TEXT;
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS temperature INTEGER; -- in Fahrenheit
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS wind TEXT;

-- Add course difficulty columns
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS course_rating DECIMAL(4,1); -- e.g., 75.5
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS slope_rating INTEGER; -- e.g., 145

-- Add comments for documentation
COMMENT ON COLUMN golf_rounds.weather IS 'Weather conditions during the round (e.g., Sunny, Cloudy, Rainy)';
COMMENT ON COLUMN golf_rounds.temperature IS 'Temperature in Fahrenheit during the round';
COMMENT ON COLUMN golf_rounds.wind IS 'Wind conditions during the round (e.g., Calm, Light Breeze, Windy)';
COMMENT ON COLUMN golf_rounds.course_rating IS 'USGA Course Rating (difficulty for scratch golfer)';
COMMENT ON COLUMN golf_rounds.slope_rating IS 'USGA Slope Rating (relative difficulty, 55-155)';

-- Verification query
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'golf_rounds'
  AND column_name IN ('weather', 'temperature', 'wind', 'course_rating', 'slope_rating')
ORDER BY column_name;
