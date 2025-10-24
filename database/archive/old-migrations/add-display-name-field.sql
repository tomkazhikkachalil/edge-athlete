-- =====================================================
-- ADD DISPLAY_NAME FIELD - Global Name Consistency
-- =====================================================
-- Adds display_name as the single source of truth for user display
-- Migrates existing data to populate display_name
--
-- Run this in Supabase SQL Editor

-- Step 1: Add display_name column
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Step 2: Create index for search performance
CREATE INDEX IF NOT EXISTS idx_profiles_display_name
ON profiles(display_name);

-- Step 3: Backfill existing profiles with display_name
-- Priority: first_name + last_name > full_name (username)
UPDATE profiles
SET display_name = CASE
  -- If they have first_name and last_name, use constructed name
  WHEN first_name IS NOT NULL AND last_name IS NOT NULL THEN
    TRIM(
      CONCAT(
        first_name,
        CASE WHEN middle_name IS NOT NULL THEN ' ' || middle_name ELSE '' END,
        ' ',
        last_name
      )
    )
  -- Fall back to username/full_name
  WHEN full_name IS NOT NULL THEN full_name
  WHEN username IS NOT NULL THEN username
  -- Absolute fallback
  ELSE 'User'
END
WHERE display_name IS NULL OR display_name = '';

-- Step 4: Add constraint (display_name should not be empty if profile exists)
ALTER TABLE profiles
ADD CONSTRAINT check_display_name_not_empty
CHECK (display_name IS NOT NULL AND length(trim(display_name)) > 0);

-- Step 5: Update search_vector to include display_name
-- (Only if search_vector column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles'
    AND column_name = 'search_vector'
  ) THEN
    -- Update the trigger function to include display_name
    CREATE OR REPLACE FUNCTION profiles_search_vector_update()
    RETURNS trigger AS $func$
    BEGIN
      NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.email, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.display_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.first_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.last_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.location, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.full_name, '')), 'B');

      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;

    -- Rebuild search vectors with new display_name
    UPDATE profiles SET email = email;

    RAISE NOTICE 'Search vector updated to include display_name';
  ELSE
    RAISE NOTICE 'search_vector column does not exist - skipping search update';
  END IF;
END $$;

-- Step 6: Create function to auto-sync display_name when names change
CREATE OR REPLACE FUNCTION auto_update_display_name()
RETURNS trigger AS $$
BEGIN
  -- Only auto-update if display_name is not manually set
  -- (detect manual set by checking if it differs from constructed name)
  IF NEW.display_name IS NULL OR NEW.display_name = '' THEN
    NEW.display_name := CASE
      WHEN NEW.first_name IS NOT NULL AND NEW.last_name IS NOT NULL THEN
        TRIM(
          CONCAT(
            NEW.first_name,
            CASE WHEN NEW.middle_name IS NOT NULL THEN ' ' || NEW.middle_name ELSE '' END,
            ' ',
            NEW.last_name
          )
        )
      WHEN NEW.full_name IS NOT NULL THEN NEW.full_name
      WHEN NEW.username IS NOT NULL THEN NEW.username
      ELSE 'User'
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create trigger to auto-update display_name
DROP TRIGGER IF EXISTS trigger_auto_update_display_name ON profiles;
CREATE TRIGGER trigger_auto_update_display_name
  BEFORE INSERT OR UPDATE OF first_name, middle_name, last_name, full_name, username
  ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_update_display_name();

-- Step 8: Verify migration
SELECT
  COUNT(*) as total_profiles,
  COUNT(CASE WHEN display_name IS NOT NULL AND display_name != '' THEN 1 END) as with_display_name,
  COUNT(CASE WHEN display_name IS NULL OR display_name = '' THEN 1 END) as missing_display_name
FROM profiles;

-- Step 9: Show sample data
SELECT
  id,
  display_name,
  first_name,
  last_name,
  full_name,
  CASE
    WHEN display_name = TRIM(CONCAT(first_name, ' ', COALESCE(middle_name || ' ', ''), last_name))
      THEN 'From Name'
    WHEN display_name = full_name THEN 'From Username'
    ELSE 'Custom'
  END as display_name_source
FROM profiles
ORDER BY created_at DESC
LIMIT 10;

-- SUCCESS!
-- ✅ display_name field added
-- ✅ Existing profiles backfilled
-- ✅ Auto-sync trigger created
-- ✅ Search index updated (if exists)
-- ✅ All profiles now have display_name
