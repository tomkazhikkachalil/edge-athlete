-- COMPLETE NAME STRUCTURE MIGRATION
-- This migration updates the profile name structure to use separate name fields
--
-- CHANGES:
-- 1. Add middle_name column to profiles table
-- 2. Update field meanings:
--    - first_name, middle_name, last_name = Real name parts
--    - full_name = Username/handle (like @johndoe)
--    - username = Alternative username (if needed)
--
-- IMPORTANT: Run this BEFORE deploying the code changes

-- ============================================================================
-- STEP 1: Add middle_name column
-- ============================================================================
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS middle_name TEXT;

-- ============================================================================
-- STEP 2: Add column comments for clarity
-- ============================================================================
COMMENT ON COLUMN profiles.first_name IS 'User''s first/given name';
COMMENT ON COLUMN profiles.middle_name IS 'User''s middle name (optional)';
COMMENT ON COLUMN profiles.last_name IS 'User''s last/family name';
COMMENT ON COLUMN profiles.full_name IS 'Username/handle for the user (e.g., johndoe, john_doe)';
COMMENT ON COLUMN profiles.username IS 'Alternative username if needed';

-- ============================================================================
-- STEP 3: Verify the change
-- ============================================================================
-- Run this to check that middle_name column was added:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'profiles'
-- AND column_name IN ('first_name', 'middle_name', 'last_name', 'full_name', 'username')
-- ORDER BY column_name;

-- ============================================================================
-- STEP 4: (Optional) Migrate existing data
-- ============================================================================
-- If you have existing users with data in full_name that should be their username,
-- you can migrate it like this:
--
-- UPDATE profiles
-- SET username = full_name
-- WHERE username IS NULL AND full_name IS NOT NULL;
--
-- Then manually update first_name, middle_name, last_name for existing users
-- or have them update their profiles through the UI

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Check all name-related columns for a specific user:
-- SELECT id, first_name, middle_name, last_name, full_name, username, email
-- FROM profiles
-- WHERE email = 'your-email@example.com';

-- List all users with incomplete name data:
-- SELECT id, email, first_name, middle_name, last_name, full_name
-- FROM profiles
-- WHERE first_name IS NULL OR last_name IS NULL
-- ORDER BY created_at DESC
-- LIMIT 20;
