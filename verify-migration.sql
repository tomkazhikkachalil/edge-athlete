-- VERIFICATION SCRIPT
-- Run this in Supabase SQL Editor to verify the migration was successful

-- Check 1: Verify middle_name column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles'
AND column_name IN ('first_name', 'middle_name', 'last_name', 'full_name', 'username')
ORDER BY column_name;

-- Expected result: Should show all 5 columns including middle_name

-- Check 2: View column comments
SELECT
    col_description('profiles'::regclass, ordinal_position) as comment,
    column_name
FROM information_schema.columns
WHERE table_name = 'profiles'
AND column_name IN ('first_name', 'middle_name', 'last_name', 'full_name', 'username')
ORDER BY column_name;

-- Check 3: Sample data from profiles (shows current name structure)
SELECT
    id,
    email,
    first_name,
    middle_name,
    last_name,
    full_name,
    username
FROM profiles
LIMIT 5;

-- This will show you if users have first_name/last_name populated
-- If they're NULL, users will show as "Unknown User" until they update their profile
