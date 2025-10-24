-- Add middle_name column to profiles table
-- This migration updates the profile structure to use:
-- - first_name, middle_name (optional), last_name for real names
-- - full_name becomes the username/handle
-- - username field for alternative username

-- Add middle_name column
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS middle_name TEXT;

-- Add comment to clarify field usage
COMMENT ON COLUMN profiles.first_name IS 'User''s first/given name';
COMMENT ON COLUMN profiles.middle_name IS 'User''s middle name (optional)';
COMMENT ON COLUMN profiles.last_name IS 'User''s last/family name';
COMMENT ON COLUMN profiles.full_name IS 'Username/handle for the user (e.g., johndoe, john_doe)';
COMMENT ON COLUMN profiles.username IS 'Alternative username if needed';

-- You can run this to update existing records if needed:
-- UPDATE profiles
-- SET username = full_name
-- WHERE username IS NULL AND full_name IS NOT NULL;
