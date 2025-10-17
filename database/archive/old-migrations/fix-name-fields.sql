-- FIX NAME FIELDS: Split full_name into first_name and last_name for existing profiles
-- This fixes profiles that were created before the name splitting logic was added

-- =====================================================
-- BACKUP EXISTING DATA (Optional but recommended)
-- =====================================================

-- Create a backup table (uncomment if you want a backup)
-- CREATE TABLE profiles_backup AS SELECT * FROM profiles;

-- =====================================================
-- UPDATE EXISTING PROFILES
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

-- =====================================================
-- FUTURE-PROOF: Create Function to Auto-Split Names
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

-- Create trigger to auto-split names on insert/update
DROP TRIGGER IF EXISTS auto_split_full_name ON profiles;
CREATE TRIGGER auto_split_full_name
  BEFORE INSERT OR UPDATE OF full_name
  ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION split_full_name();

-- =====================================================
-- TEST THE TRIGGER
-- =====================================================

-- Test with a new profile (uncomment to test)
-- INSERT INTO profiles (id, email, full_name)
-- VALUES (
--   gen_random_uuid(),
--   'test.trigger@example.com',
--   'John Doe Smith'
-- );
--
-- -- Verify the trigger worked
-- SELECT full_name, first_name, last_name
-- FROM profiles
-- WHERE email = 'test.trigger@example.com';
--
-- -- Cleanup test
-- DELETE FROM profiles WHERE email = 'test.trigger@example.com';

-- =====================================================
-- NOTES
-- =====================================================

-- This script does three things:
-- 1. Updates existing profiles to split full_name into first/last names
-- 2. Creates a database trigger to auto-split names on future inserts/updates
-- 3. Provides verification queries to check the results

-- Name Splitting Logic:
-- - "John" → first_name: "John", last_name: NULL
-- - "John Doe" → first_name: "John", last_name: "Doe"
-- - "John Michael Doe" → first_name: "John", last_name: "Michael Doe"
-- - "María García López" → first_name: "María", last_name: "García López"

-- This ensures:
-- ✅ Search by first_name works
-- ✅ Search by last_name works
-- ✅ Search by full_name works
-- ✅ All future profiles automatically get split names
-- ✅ Existing profiles are retroactively fixed

-- To rollback (if needed):
-- DROP TRIGGER IF EXISTS auto_split_full_name ON profiles;
-- DROP FUNCTION IF EXISTS split_full_name();
-- -- Restore from backup if created:
-- -- DELETE FROM profiles;
-- -- INSERT INTO profiles SELECT * FROM profiles_backup;
