-- ============================================
-- DISABLE AUTOMATIC PROFILE CREATION TRIGGER
-- This allows our API to handle profile creation instead
-- ============================================

-- This is an alternative approach: disable the trigger and let the API create profiles
-- This gives us more control and better error handling

-- Drop the trigger (keep the function in case we need it later)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Verify trigger is removed
SELECT
  trigger_name,
  event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Should return 0 rows if trigger is disabled

RAISE NOTICE 'Automatic profile creation trigger disabled. API will handle profile creation.';
