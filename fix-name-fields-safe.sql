-- FIX NAME FIELDS: Split full_name into first_name and last_name for existing profiles
-- SAFE VERSION: Won't error if trigger already exists

-- =====================================================
-- UPDATE EXISTING PROFILES (Safe - can run multiple times)
-- =====================================================

-- Update profiles where full_name exists but first_name or last_name is missing
UPDATE profiles
SET
  first_name = CASE
    WHEN first_name IS NULL OR first_name = '' THEN
      -- Extract first word from full_name
      SPLIT_PART(TRIM(full_name), ' ', 1)
    ELSE
      first_name
  END,
  last_name = CASE
    WHEN last_name IS NULL OR last_name = '' THEN
      -- Extract everything after first word from full_name
      CASE
        WHEN ARRAY_LENGTH(STRING_TO_ARRAY(TRIM(full_name), ' '), 1) > 1 THEN
          TRIM(SUBSTRING(TRIM(full_name) FROM POSITION(' ' IN TRIM(full_name)) + 1))
        ELSE
          NULL  -- Single name, no last name
      END
    ELSE
      last_name
  END
WHERE
  full_name IS NOT NULL
  AND full_name != ''
  AND (
    first_name IS NULL
    OR first_name = ''
    OR last_name IS NULL
    OR last_name = ''
  );

-- =====================================================
-- CREATE FUNCTION (Safe - replaces if exists)
-- =====================================================

-- Create a function that automatically splits full_name on insert/update
CREATE OR REPLACE FUNCTION split_full_name()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if full_name changed and is not null
  IF NEW.full_name IS NOT NULL AND NEW.full_name != '' THEN
    -- If first_name is empty, extract it from full_name
    IF NEW.first_name IS NULL OR NEW.first_name = '' THEN
      NEW.first_name := SPLIT_PART(TRIM(NEW.full_name), ' ', 1);
    END IF;

    -- If last_name is empty, extract it from full_name
    IF NEW.last_name IS NULL OR NEW.last_name = '' THEN
      -- Check if there are multiple words in full_name
      IF ARRAY_LENGTH(STRING_TO_ARRAY(TRIM(NEW.full_name), ' '), 1) > 1 THEN
        NEW.last_name := TRIM(SUBSTRING(
          TRIM(NEW.full_name)
          FROM POSITION(' ' IN TRIM(NEW.full_name)) + 1
        ));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- CREATE TRIGGER (Safe - drops if exists first)
-- =====================================================

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS auto_split_full_name ON profiles;

-- Create trigger to auto-split names on insert/update
CREATE TRIGGER auto_split_full_name
  BEFORE INSERT OR UPDATE OF full_name
  ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION split_full_name();

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check the results
SELECT
  id,
  full_name,
  first_name,
  last_name,
  email
FROM profiles
ORDER BY created_at DESC
LIMIT 10;

-- Count profiles with missing name fields
SELECT
  COUNT(*) FILTER (WHERE full_name IS NOT NULL AND full_name != '') as has_full_name,
  COUNT(*) FILTER (WHERE first_name IS NULL OR first_name = '') as missing_first_name,
  COUNT(*) FILTER (WHERE last_name IS NULL OR last_name = '') as missing_last_name,
  COUNT(*) as total_profiles
FROM profiles;

-- Check that trigger was created
SELECT
  trigger_name,
  event_manipulation,
  event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'auto_split_full_name'
  AND event_object_table = 'profiles';
